// deno-lint-ignore-file no-explicit-any

import { Config } from "../env.ts";
import { jsonResponse } from "../utils/responseUtils.ts";
import { getMediaAndSearchResults } from "../utils/getMediaAndSearchResults.ts";
import { parseRequestedEpisode } from "../utils/parseRequestedEpisode.ts";
import { md5 } from "../utils/md5Encoder.ts";
import { redis } from "../utils/redis.ts";
import { filenameParse as parseRelease } from "@ctrl/video-filename-parser";
import { formatVideoCard } from "../utils/streamFilters.ts";
import { checkNzb } from "../lib/nzbcheck.ts";
import { getActiveNntpServerUrls } from "../utils/sqlite.ts";

import {
    REGEX_JSON_EXT,
    extractGuidFromUrl,
    getResolutionRank,
    getResolutionIcon,
    normalizeStreamName,
    parseRedisJsonScalar,
} from "../utils/streamHelpers.ts";

import type { RouteMatch, Stream } from "./types.ts";

// --- CONSTANTS ---
const NNTP_SERVERS = getActiveNntpServerUrls();
const GIGABYTE = 1024 * 1024 * 1024;
const STREAM_TTL = 172800; // 2 days in seconds

export const streamRoute: RouteMatch = {
    pattern: new URLPattern({ pathname: "/:apiKey/stream/:type/:encodedParams" }),
    methods: ["GET"],
    handler: async (_req: Request, match: URLPatternResult): Promise<Response> => {
        const { apiKey, type, encodedParams } = match.pathname.groups;

        if (apiKey !== Config.ADDON_SHARED_SECRET) {
            return jsonResponse({ error: "Unauthorized" }, 401);
        }

        if (type !== "movie" && type !== "series") {
            return jsonResponse({ error: "Invalid media type" }, 400);
        }

        try {
            const decoded = decodeURIComponent(encodedParams!).replace(REGEX_JSON_EXT, "");

            // 1. Resolve Query Info
            const requestedInfo = type === "series"
                ? parseRequestedEpisode(type, decoded) ?? {}
                : { imdbid: decoded };

            // 2. Fetch Search Results
            const { results } = await getMediaAndSearchResults(type, requestedInfo);

            if (!results || results.length === 0) {
                return jsonResponse({ streams: [] });
            }

            // 3. Prepare NZB Checks & Enrich Data
            const itemsToCheck: any[] = [];
            const validResults: any[] = [];

            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                if (r.indexer && r.guid) {
                    const guid = extractGuidFromUrl(r.guid);
                    (r as any).extractedGuid = guid;
                    validResults.push(r);
                    itemsToCheck.push({ source_indexer: r.indexer, file_id: guid });
                }
            }

            // 4. Batch NZB Check (Network)
            const nzbCheckResults = itemsToCheck.length ? await checkNzb(itemsToCheck) : { data: {} };
            const nzbData = (nzbCheckResults?.data ?? {}) as Record<string, any>;

            // 5. Pre-Process & Group (Only Parsing, deferring Formatting)
            const grouped = new Map<string, any[]>();
            const isSeries = type === "series";

            for (let i = 0; i < validResults.length; i++) {
                const r = validResults[i];
                const key = `${r.indexer.toLowerCase()}:${r.extractedGuid}`;
                const status = nzbData[key];

                // Filter incomplete immediately
                if (status?.is_complete === false) continue;

                r.is_complete = status?.is_complete ?? null;

                const parsed = parseRelease(r.title, isSeries);

                // OPTIMIZATION: Extract resolution directly instead of doing a dummy formatVideoCard call
                const resolution = parsed.resolution || "Unknown";

                r.resolution = resolution;
                r.parsedInfo = parsed;

                let group = grouped.get(resolution);
                if (!group) {
                    group = [];
                    grouped.set(resolution, group);
                }
                group.push(r);
            }

            // 6. Sort and Slice Winners
            const sortedResolutions = Array.from(grouped.keys())
                .sort((a, b) => getResolutionRank(b) - getResolutionRank(a));

            const finalStreamsRaw: any[] = [];
            const getPipeline = redis.pipeline();
            const USE_NNTP = Config.USE_STREMIO_NNTP;

            for (let i = 0; i < sortedResolutions.length; i++) {
                const res = sortedResolutions[i];
                const group = grouped.get(res)!;

                // Sort by Age then Size, and limit to top 5
                group.sort((a, b) => (a.age - b.age) || (b.size - a.size));
                const limit = Math.min(group.length, 5);

                for (let j = 0; j < limit; j++) {
                    const r = group[j];
                    r.hash = md5(r.downloadUrl);
                    finalStreamsRaw.push(r);

                    // Queue Redis GET
                    getPipeline.call("JSON.GET", `streams:${r.hash}`, "$.viewPath");
                }
            }

            // 7. OPTIMIZATION: Fire the Redis Pipeline IMMEDIATELY
            // This allows the network roundtrip to happen concurrently with our string formatting
            const cacheChecksPromise = finalStreamsRaw.length > 0 ? getPipeline.exec() : Promise.resolve([]);

            // 8. Execute heavy CPU formatting while waiting for Redis
            for (let i = 0; i < finalStreamsRaw.length; i++) {
                const r = finalStreamsRaw[i];

                // Faster float formatting: trims zeros automatically via Number() cast
                const sizeStr = Number((r.size / GIGABYTE).toFixed(2)).toString();

                const { lines } = formatVideoCard(r.parsedInfo, {
                    size: sizeStr,
                    proxied: false,
                    source: r.indexer ?? "Usenet",
                    isComplete: r.is_complete,
                    age: r.age,
                    grabs: r.grabs,
                });

                r.lines = lines;
            }

            // 9. Await Redis results
            const cacheChecks = await cacheChecksPromise;

            // 10. Construct Streams & Queue Redis SETs
            const setPipeline = redis.pipeline();
            const streams: Stream[] = [];
            const addonBase = Config.ADDON_BASE_URL;

            for (let i = 0; i < finalStreamsRaw.length; i++) {
                const r = finalStreamsRaw[i];
                const hash = r.hash;

                // Check Cache Result
                const viewPathRaw = cacheChecks?.[i]?.[1];
                const viewPath = parseRedisJsonScalar(viewPathRaw);
                const prefix = (viewPath && viewPath.length > 0) ? "⚡" : "";

                // Build Stream Object
                const streamObj: Stream = {
                    name: normalizeStreamName(`${getResolutionIcon(r.resolution)} ${prefix} ${r.resolution}`),
                    title: r.lines,
                    size: r.size,
                    behaviorHints: {
                        bingeGroup: `nzb-${r.resolution}`,
                        notWebReady: true
                    }
                };

                if (USE_NNTP) {
                    streamObj.nzbUrl = `${addonBase}/nzb/proxy/${hash}.nzb`;
                    streamObj.servers = NNTP_SERVERS;
                } else {
                    streamObj.url = `${addonBase}/${Config.ADDON_SHARED_SECRET}/nzb/stream/${hash}`;
                }

                streams.push(streamObj);

                // Queue Cache Set
                setPipeline.call(
                    "JSON.SET",
                    `streams:${hash}`,
                    "$",
                    JSON.stringify({
                        downloadUrl: r.downloadUrl,
                        title: r.title,
                        size: r.size,
                        guid: r.extractedGuid,
                        indexer: r.indexer,
                        type,
                        fileName: r.fileName,
                        rawImdbId: decoded,
                    }),
                    "NX",
                );
                // Expiration still runs even if NX skips the SET, giving you active-refreshing TTL!
                setPipeline.expire(`streams:${hash}`, STREAM_TTL);
            }

            // 11. Fire SETs (must await to ensure V8/Deno completes them before GC sweep)
            if (streams.length > 0) {
                await setPipeline.exec();
            }

            return jsonResponse({ streams });

        } catch (err) {
            console.error("Stream list error:", err);
            return jsonResponse({ error: "Failed to load streams" }, 502);
        }
    },
};
