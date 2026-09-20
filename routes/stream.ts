// deno-lint-ignore-file no-explicit-any

import { Config } from "../env.ts";
import { jsonResponse } from "../utils/responseUtils.ts";
import { getMediaAndSearchResults } from "../utils/getMediaAndSearchResults.ts";
import { parseRequestedEpisode } from "../utils/parseRequestedEpisode.ts";
import { md5 } from "../utils/md5Encoder.ts";
import { keys, STREAM_TTL_SEC } from "../utils/cacheKeys.ts";
import { getRedis } from "../utils/redis.ts";
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

const GIGABYTE = 1024 * 1024 * 1024;

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

            const requestedInfo = type === "series"
                ? parseRequestedEpisode(type, decoded) ?? {}
                : { imdbid: decoded };

            const { results, searchKey } = await getMediaAndSearchResults(type, requestedInfo);

            if (!results || results.length === 0) {
                return jsonResponse({ streams: [] });
            }

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

            const nzbCheckResults = itemsToCheck.length ? await checkNzb(itemsToCheck) : { data: {} };
            const nzbData = (nzbCheckResults?.data ?? {}) as Record<string, any>;

            const grouped = new Map<string, any[]>();
            const isSeries = type === "series";

            for (let i = 0; i < validResults.length; i++) {
                const r = validResults[i];
                const key = `${r.indexer.toLowerCase()}:${r.extractedGuid}`;
                const status = nzbData[key];

                if (status?.is_complete === false) continue;

                r.is_complete = status?.is_complete ?? null;

                const parsed = parseRelease(r.title, isSeries);
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

            const sortedResolutions = Array.from(grouped.keys())
                .sort((a, b) => getResolutionRank(b) - getResolutionRank(a));

            const finalStreamsRaw: any[] = [];
            const redis = getRedis();
            const getPipeline = redis.pipeline();
            const USE_NNTP = Config.USE_STREMIO_NNTP;
            const nntpServers = USE_NNTP ? getActiveNntpServerUrls() : [];

            for (let i = 0; i < sortedResolutions.length; i++) {
                const res = sortedResolutions[i];
                const group = grouped.get(res)!;

                group.sort((a, b) => (a.age - b.age) || (b.size - a.size));
                const limit = Math.min(group.length, 5);

                for (let j = 0; j < limit; j++) {
                    const r = group[j];
                    r.hash = md5(r.downloadUrl);
                    finalStreamsRaw.push(r);
                    getPipeline.call("JSON.GET", keys.stream(r.hash), "$.viewPath");
                }
            }

            const cacheChecksPromise = finalStreamsRaw.length > 0 ? getPipeline.exec() : Promise.resolve([]);

            for (let i = 0; i < finalStreamsRaw.length; i++) {
                const r = finalStreamsRaw[i];
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

            const cacheChecks = await cacheChecksPromise;
            const setPipeline = redis.pipeline();
            const streams: Stream[] = [];
            const addonBase = Config.ADDON_BASE_URL;

            for (let i = 0; i < finalStreamsRaw.length; i++) {
                const r = finalStreamsRaw[i];
                const hash = r.hash;
                const viewPathRaw = cacheChecks?.[i]?.[1];
                const viewPath = parseRedisJsonScalar(viewPathRaw);
                const prefix = (viewPath && viewPath.length > 0) ? "⚡" : "";

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
                    streamObj.servers = nntpServers;
                } else {
                    streamObj.url = `${addonBase}/${Config.ADDON_SHARED_SECRET}/nzb/stream/${hash}`;
                }

                streams.push(streamObj);

                const streamKey = keys.stream(hash);
                const meta = {
                    downloadUrl: r.downloadUrl,
                    title: r.title,
                    size: r.size,
                    guid: r.extractedGuid,
                    indexer: r.indexer,
                    type,
                    fileName: r.fileName,
                    rawImdbId: decoded,
                    searchKey,
                };
                setPipeline.call("JSON.SET", streamKey, "$", JSON.stringify(meta), "NX");
                setPipeline.call("JSON.MERGE", streamKey, "$", JSON.stringify({ searchKey, downloadUrl: r.downloadUrl, rawImdbId: decoded }));
                setPipeline.expire(streamKey, STREAM_TTL_SEC);
            }

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
