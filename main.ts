// deno-lint-ignore-file no-explicit-any
import "./utils/asciiArt.ts";
import { join } from "@std/path/posix";
import { getMediaAndSearchResults } from "./utils/getMediaAndSearchResults.ts";

import { Config, validateConfig } from "./env.ts";
import { md5 } from "./utils/md5Encoder.ts";
import { streamNzbdavProxy } from "./lib/nzbDav/nzbDav.ts";
import { parseRequestedEpisode } from "./utils/parseRequestedEpisode.ts";
import { redis } from "./utils/redis.ts";

import { streamFailureVideo } from "./lib/streamFailureVideo.ts";
import { jsonResponse } from "./utils/responseUtils.ts";

import { filenameParse as parseRelease } from "@ctrl/video-filename-parser";
import { formatVideoCard } from "./utils/streamFilters.ts";
import { checkNzb } from "./lib/nzbcheck.ts";
import { getActiveNntpServerUrls } from "./utils/sqlite.ts";

// --- TYPES ---
interface Stream {
    name: string;
    title: string;
    url?: string;
    nzbUrl?: string;
    servers?: string[];
    size: number;
}

interface ProcessedResult {
    result: any;
    guid: string;
    indexer: string;
}

// --- CONSTANTS & CACHE ---
const NNTP_SERVERS = getActiveNntpServerUrls();

// Pre-compile Regex for performance
const REGEX_GUID_PARAM = /[?&]guid=([^&]+)/;
const REGEX_LAST_SEGMENT = /\/([^\/?#]+)$/;
const REGEX_JSON_EXT = /\.json$/;

// Resolution Lookup Maps (Order matters: checked top-down in loop)
const RES_RANK_MAP: Record<string, number> = {
    "4k": 4, "2160": 4, "uhd": 4,
    "2k": 3, "1440": 3,
    "1080": 2, "fhd": 2,
    "720": 1, "hd": 1
};

const RES_ICON_MAP: Record<string, string> = {
    "4k": "🔥 4K UHD", "2160": "🔥 4K UHD", "uhd": "🔥 4K UHD",
    "2k": "🔥 2K", "1440": "🔥 2K",
    "1080": "🚀 FHD", "fhd": "🚀 FHD",
    "720": "💿 HD", "hd": "💿 HD"
};

const PATTERNS = {
    manifest: new URLPattern({ pathname: "/:apiKey/manifest.json" }),
    stream: new URLPattern({ pathname: "/:apiKey/stream/:type/:encodedParams" }),
    nzbStream: new URLPattern({ pathname: "/:apiKey/nzb/stream/:key" }),
    nzbProxy: new URLPattern({ pathname: "/nzb/proxy/:hash.nzb" }),
};

// In-Memory Asset Cache
let ICON_CACHE: Uint8Array | null = null;

// --- HELPERS ---

function parseRedisJson<T>(raw: unknown): T | null {
    if (!raw) return null;
    try {
        const val = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Array.isArray(val) ? val[0] : val;
    } catch {
        return null;
    }
}

/**
 * Optimized GUID extraction using Regex instead of new URL()
 */
function extractGuidFromUrl(urlString: string): string {
    if (Config.NZBHYDRA_URL && Config.NZBHYDRA_API_KEY) {
        return urlString;
    }

    // Fast path: Regex check for query param
    const queryMatch = REGEX_GUID_PARAM.exec(urlString);
    if (queryMatch) return queryMatch[1];

    // Fast path: Regex check for last path segment
    const pathMatch = REGEX_LAST_SEGMENT.exec(urlString);
    if (pathMatch) return pathMatch[1];

    return urlString;
}

function getResolutionRank(resolution: string): number {
    const r = resolution.toLowerCase();
    for (const k in RES_RANK_MAP) {
        if (r.includes(k)) return RES_RANK_MAP[k];
    }
    return 0;
}

function getResolutionIcon(resolution: string): string {
    const r = resolution.toLowerCase();
    for (const k in RES_ICON_MAP) {
        if (r.includes(k)) return RES_ICON_MAP[k];
    }
    return "💩 Unknown";
}

// --- MAIN HANDLER ---

async function handler(req: Request): Promise<Response> {
    const method = req.method;
    const urlString = req.url; // Use string for pattern matching to avoid unnecessary parsing

    // --- GLOBAL CORS (OPTIONS) ---
    if (method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Range",
                "Access-Control-Max-Age": "86400",
            },
        });
    }

    // --- STATIC ASSETS (Optimized) ---
    if (method === "GET" && urlString.endsWith("/assets/icon.png")) {
        try {
            if (!ICON_CACHE) {
                const iconPath = join(Deno.cwd(), "public", "assets", "icon.png");
                ICON_CACHE = await Deno.readFile(iconPath);
            }
            // Fix: Cast to 'any' or 'BodyInit' to satisfy TS compiler
            return new Response(ICON_CACHE as any, {
                headers: {
                    "Content-Type": "image/png",
                    "Cache-Control": "public, max-age=86400, immutable",
                    "Access-Control-Allow-Origin": "*",
                },
            });
        } catch (err) {
            console.error("Failed to load icon.png:", err);
            return new Response("Not found", { status: 404 });
        }
    }

    // Parse URL object only when needed for complex routing
    const url = new URL(urlString);

    // --- ROOT CHECK ---
    if (url.pathname === "/" && method === "GET") {
        return new Response(
            "Hello, the server is running! This is using the mkcfdc version of UsenetStreamer by Sanket9225.",
            { headers: { "Content-Type": "text/plain" } }
        );
    }

    // --- MANIFEST ---
    const manifestMatch = PATTERNS.manifest.exec(url);
    if (manifestMatch && method === "GET") {
        if (manifestMatch.pathname.groups.apiKey !== Config.ADDON_SHARED_SECRET) {
            return jsonResponse({ error: "Unauthorized" }, 401);
        }

        return jsonResponse({
            id: "com.usenet.streamer",
            version: "1.0.1",
            name: "UsenetStreamer",
            description: "Usenet-powered instant streams for Stremio via Prowlarr and NZBDav",
            logo: `${Config.ADDON_BASE_URL.replace(/\/$/, "")}/assets/icon.png`,
            resources: ["stream"],
            types: ["movie", "series"],
            catalogs: [],
            idPrefixes: ["tt"],
        });
    }

    // --- STREAM HANDLER ---
    const streamMatch = PATTERNS.stream.exec(url);
    if (streamMatch && method === "GET") {
        const { apiKey, type, encodedParams } = streamMatch.pathname.groups;

        if (apiKey !== Config.ADDON_SHARED_SECRET) return jsonResponse({ error: "Unauthorized" }, 401);
        if (type !== "movie" && type !== "series") return jsonResponse({ error: "Invalid media type" }, 400);

        try {
            const decoded = decodeURIComponent(encodedParams!).replace(REGEX_JSON_EXT, "");

            // 1. Resolve Query Info
            const requestedInfo = type === "series"
                ? parseRequestedEpisode(type, decoded) ?? {}
                : { imdbid: decoded };

            // 2. Fetch Search Results
            const { results } = await getMediaAndSearchResults(type, requestedInfo);

            // 3. Prepare NZB Checks & Extract GUIDs once
            const itemsToCheck: any[] = [];
            const resultsWithGuid: ProcessedResult[] = [];

            // Single pass to prepare data
            for (const r of results) {
                if (r.indexer && r.guid) {
                    const guid = extractGuidFromUrl(r.guid);
                    // Store the extracted GUID to avoid re-extracting later
                    resultsWithGuid.push({ result: r, guid, indexer: r.indexer });
                    itemsToCheck.push({ source_indexer: r.indexer, file_id: guid });
                }
            }

            // 4. Batch NZB Check
            const nzbCheckResults = itemsToCheck.length ? await checkNzb(itemsToCheck) : { data: {} };
            const nzbData = (nzbCheckResults?.data ?? {}) as Record<string, any>;

            // 5. Process & Group Results
            const grouped = new Map<string, any[]>();

            for (const { result: r, guid, indexer } of resultsWithGuid) {
                // Key construction: Force lowercase once
                const key = `${indexer.toLowerCase()}:${guid}`;
                const status = nzbData[key];

                r.is_complete = status?.is_complete ?? null;
                // Optimization: Fail fast
                if (r.is_complete === false) continue;

                r.cache_hit = status?.cache_hit ?? false;
                r.last_updated = status?.last_updated ?? null;

                // Heavy lifting (Parsing) only done for valid items
                const parsed = parseRelease(r.title, type === "series");
                const { resolution, lines } = formatVideoCard(parsed, {
                    size: (r.size / (1024 ** 3)).toFixed(2).replace(/\.?0+$/, ""),
                    proxied: false,
                    source: indexer ?? "Usenet",
                    isComplete: r.is_complete,
                    age: r.age,
                    grabs: r.grabs,
                });

                r.resolution = resolution;
                r.lines = lines;
                r.extractedGuid = guid; // Attach for later usage

                if (!grouped.has(resolution)) grouped.set(resolution, []);
                grouped.get(resolution)!.push(r);
            }

            // 6. Sort & Flatten
            // Sort inner arrays by age then size, take top 5, then flat, then sort by resolution rank
            const filtered = Array.from(grouped.values())
                .map(arr => arr.sort((a, b) => (a.age - b.age) || (b.size - a.size)).slice(0, 5))
                .flat()
                .sort((a, b) => getResolutionRank(b.resolution) - getResolutionRank(a.resolution));

            // 7. Redis Cache Operations
            const getPipeline = redis.pipeline();
            const setPipeline = redis.pipeline();
            const streams: Stream[] = [];

            // Batch GET requests
            for (const r of filtered) {
                // Pre-calc MD5 once
                r.hash = md5(r.downloadUrl);
                getPipeline.call("JSON.GET", `streams:${r.hash}`, "$.viewPath");
            }

            const cacheChecks = await getPipeline.exec();
            const USE_NNTP = Config.USE_STREMIO_NNTP;

            for (let i = 0; i < filtered.length; i++) {
                const r = filtered[i];
                const hash = r.hash; // Reuse pre-calced hash
                const key = `streams:${hash}`;

                const cacheResult = cacheChecks?.[i]?.[1];
                const hasViewPath = Array.isArray(cacheResult) && cacheResult.length > 0 && cacheResult[0];
                const prefix = hasViewPath ? "⚡" : "";

                // Construct Stream Object
                const streamObj: Stream = {
                    name: `${getResolutionIcon(r.resolution)} ${prefix} ${r.resolution}`,
                    title: r.lines,
                    size: r.size,
                };

                if (USE_NNTP) {
                    streamObj.nzbUrl = `${Config.ADDON_BASE_URL}/nzb/proxy/${hash}.nzb`;
                    streamObj.servers = NNTP_SERVERS;
                } else {
                    streamObj.url = `${Config.ADDON_BASE_URL}/${Config.ADDON_SHARED_SECRET}/nzb/stream/${hash}`;
                }

                streams.push(streamObj);

                // Queue SET operation if needed
                if (!hasViewPath) {
                    setPipeline.call(
                        "JSON.SET", key, "$",
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
                        "NX"
                    );
                    setPipeline.expire(key, 172800); // 48 hours
                }
            }

            // Execute writes
            if (filtered.length > 0) {
                await setPipeline.exec();
            }

            return jsonResponse({ streams });

        } catch (err) {
            console.error("Stream list error:", err);
            return jsonResponse({ error: "Failed to load streams" }, 502);
        }
    }

    // --- NZB STREAM PROXY ---
    const nzbStreamMatch = PATTERNS.nzbStream.exec(url);
    if (nzbStreamMatch && (method === "GET" || method === "HEAD")) {
        const { apiKey, key } = nzbStreamMatch.pathname.groups;

        if (apiKey !== Config.ADDON_SHARED_SECRET) return jsonResponse({ error: "Unauthorized" }, 401);
        if (!key) return (await streamFailureVideo(req)) || jsonResponse({ error: "Missing key" }, 502);

        try {
            return await streamNzbdavProxy(key, req);
        } catch (err) {
            console.error("NZBDAV proxy error:", err);
            return (await streamFailureVideo(req)) || jsonResponse({ error: "Upstream Error" }, 502);
        }
    }

    // --- NZB DOWNLOAD PROXY ---
    const proxyMatch = PATTERNS.nzbProxy.exec(url);
    if (proxyMatch && method === "GET") {
        const { hash } = proxyMatch.pathname.groups;
        const redisKey = `streams:${hash}`;
        const resolvedKey = `${redisKey}:resolved`;

        try {
            // Parallel fetch: Get Metadata and Resolved URL Cache
            const [dataRaw, cachedResolvedUrl] = await Promise.all([
                redis.call("JSON.GET", redisKey, "$"),
                redis.get(resolvedKey)
            ]);

            const data = parseRedisJson<{ downloadUrl?: string }>(dataRaw);

            if (!data?.downloadUrl) {
                return new Response("Unknown NZB hash or invalid record", { status: 404 });
            }

            let finalResponse: Response;

            if (cachedResolvedUrl) {
                finalResponse = await fetch(cachedResolvedUrl);
            } else {
                // Manual redirect handling
                const probeResp = await fetch(data.downloadUrl, { redirect: "manual" });

                if (probeResp.status >= 300 && probeResp.status < 400) {
                    const location = probeResp.headers.get("location");
                    if (!location) return new Response("Redirect missing Location header", { status: 502 });

                    // Update cache
                    await redis.setex(resolvedKey, 21600, location);
                    finalResponse = await fetch(location);
                } else if (probeResp.status === 200) {
                    finalResponse = probeResp;
                    await redis.setex(resolvedKey, 21600, data.downloadUrl);
                } else {
                    return new Response(`Unexpected upstream status: ${probeResp.status}`, { status: 502 });
                }
            }

            if (!finalResponse.ok) {
                if (finalResponse.status === 404) await redis.del(resolvedKey);
                return new Response(await finalResponse.text(), { status: finalResponse.status });
            }

            // Create headers
            const headers = new Headers(finalResponse.headers);
            headers.set("Content-Disposition", `attachment; filename="${hash}.nzb"`);

            const cType = headers.get("content-type");
            if (!cType || cType === "application/octet-stream") {
                headers.set("Content-Type", "application/x-nzb");
            }

            return new Response(finalResponse.body, { headers });

        } catch (err) {
            console.error("[NZB Proxy] Error:", err);
            return new Response("Internal NZB proxy error", { status: 500 });
        }
    }

    return jsonResponse({ error: "Not found" }, 404);
}

// --- BOOTSTRAP ---
const missingKeys = validateConfig();
const port = Config.PORT;

if (missingKeys.length > 0) {
    console.error("❌ CRITICAL CONFIGURATION MISSING");
    console.error(`Missing: ${missingKeys.join(", ")}`);
    console.error("⚠️  Server started in MAINTENANCE MODE. Run: manage");

    Deno.serve({ port }, () => {
        return new Response(
            `[System Maintenance] Configuration required.\nMissing: ${validateConfig().join(", ")}\nUse the manage cli tool!`,
            { status: 503 }
        );
    });
} else {
    console.log("✅ %cConfiguration valid. Starting application...", "color: green");
    console.log("Install url: ", `${Config.ADDON_BASE_URL.replace(/\/$/, "")}/${Config.ADDON_SHARED_SECRET}/manifest.json`);
    Deno.serve({ port }, handler);
}
