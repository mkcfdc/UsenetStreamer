// deno-lint-ignore-file no-explicit-any
import { join } from "@std/path/posix";
import { getMediaAndSearchResults } from "./utils/getMediaAndSearchResults.ts";

import { ADDON_BASE_URL, NZBHYDRA_API_KEY, NZBHYDRA_URL, PORT, } from "./env.ts";
import { md5 } from "./utils/md5Encoder.ts";
import { streamNzbdavProxy } from "./lib/nzbDav/nzbDav.ts";
import { parseRequestedEpisode } from "./utils/parseRequestedEpisode.ts";
import { redis } from "./utils/redis.ts";

import { streamFailureVideo } from "./lib/streamFailureVideo.ts";
import { jsonResponse } from "./utils/responseUtils.ts";

import { filenameParse as parseRelease } from "@ctrl/video-filename-parser";
import { formatVideoCard } from "./utils/streamFilters.ts";
import { checkNzb } from "./lib/nzbcheck.ts";

interface Stream {
    name: string;
    title: string;
    url: string;
    size: number;
}

const PATTERNS = {
    manifest: new URLPattern({ pathname: "/:apiKey/manifest.json" }),
    stream: new URLPattern({ pathname: "/:apiKey/stream/:type/:encodedParams" }),
    nzbStream: new URLPattern({ pathname: "/:apiKey/nzb/stream/:key" }),
    nzbProxy: new URLPattern({ pathname: "/nzb/proxy/:hash.nzb" }), // Auto-handles extension check
};

// 2. Helper for Redis JSON (ReJSON returns arrays for path queries)
function parseRedisJson<T>(raw: unknown): T | null {
    if (!raw) return null;
    try {
        const val = typeof raw === "string" ? JSON.parse(raw) : raw;
        // JSON.GET with '$' usually returns an array wrapping the object
        return Array.isArray(val) ? val[0] : val;
    } catch {
        return null;
    }
}

async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

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

    // --- STATIC ASSETS ---
    if (pathname === "/assets/icon.png" && method === "GET") {
        try {
            const iconPath = join(Deno.cwd(), "public", "assets", "icon.png");
            const file = await Deno.readFile(iconPath);
            return new Response(file, {
                headers: {
                    "Content-Type": "image/png",
                    "Cache-Control": "public, max-age=86400",
                    "Access-Control-Allow-Origin": "*",
                },
            });
        } catch (err) {
            console.error("Failed to load icon.png:", err);
            return new Response("Not found", { status: 404 });
        }
    }

    // --- ROOT CHECK ---
    if (pathname === "/" && method === "GET") {
        return new Response(
            "Hello, the server is running! This is using the mkcfdc version of UsenetStreamer by Sanket9225.",
            { headers: { "Content-Type": "text/plain" } }
        );
    }

    // --- MANIFEST ---
    const manifestMatch = PATTERNS.manifest.exec(url);
    if (manifestMatch && method === "GET") {
        const { apiKey } = manifestMatch.pathname.groups;

        if (apiKey !== Deno.env.get("ADDON_SHARED_SECRET")) {
            return jsonResponse({ error: "Unauthorized" }, 401);
        }

        return jsonResponse({
            id: "com.usenet.streamer",
            version: "1.0.1",
            name: "UsenetStreamer",
            description: "Usenet-powered instant streams for Stremio via Prowlarr and NZBDav",
            logo: `${ADDON_BASE_URL.replace(/\/$/, "")}/assets/icon.png`,
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

        if (type !== "movie" && type !== "series") return jsonResponse({ error: "Invalid media type" }, 400);
        if (apiKey !== Deno.env.get("ADDON_SHARED_SECRET")) return jsonResponse({ error: "Unauthorized" }, 401);

        try {
            const decoded = decodeURIComponent(encodedParams!).replace(".json", "");

            // 1. Resolve Query Info
            const requestedInfo = type === "series"
                ? parseRequestedEpisode(type, decoded) ?? {}
                : { imdbid: decoded };

            console.log("requestedInfo:", requestedInfo);

            // 2. Fetch Search Results
            const { results } = await getMediaAndSearchResults(type, requestedInfo);

            // 3. Prepare NZB Checks (Loop 1)
            const processedItems: any[] = [];
            const itemsToCheck: any[] = [];

            for (const r of results) {

                if (r.indexer && r.guid) {
                    const fileId = extractGuidFromUrl(r.guid);
                    itemsToCheck.push({ source_indexer: r.indexer, file_id: fileId });
                }
                processedItems.push(r);
            }

            const nzbCheckResults = itemsToCheck.length ? await checkNzb(itemsToCheck) : { data: {} };
            const nzbData = (nzbCheckResults?.data ?? {}) as Record<string, any>;

            const grouped = new Map<string, any[]>();

            for (const r of processedItems) {
                // Merge Data
                const rawIndexer = String(r.indexer ?? "");
                // 1. FORCE LOWERCASE HERE TO MATCH THE API RESPONSE
                const key = `${rawIndexer.toLowerCase()}:${String(extractGuidFromUrl(r.guid) ?? "")}`;
                const status = nzbData[key];

                // if (status) console.log(`Match found for ${key}:`, status.is_complete)
                // else console.log(`No NZB check data for ${key}`);

                r.is_complete = status?.is_complete ?? null;
                r.cache_hit = status?.cache_hit ?? false;
                r.last_updated = status?.last_updated ?? null;

                // strip out the result if it is r.is_complete === false
                if (r.is_complete === false) continue;

                // Format
                const parsed = parseRelease(r.title, type === "series");
                const { resolution, lines } = formatVideoCard(parsed, {
                    size: (r.size / (1024 ** 3)).toFixed(2).replace(/\.?0+$/, ""),
                    proxied: false,
                    source: r.indexer ?? "Usenet",
                    isComplete: r.is_complete,
                    age: r.age,
                    grabs: r.grabs,
                });
                r.resolution = resolution;
                r.lines = lines;

                // Group
                if (!grouped.has(resolution)) grouped.set(resolution, []);
                grouped.get(resolution)!.push(r);
            }

            // 6. Sort & Flatten
            const filtered = Array.from(grouped.values())
                .map(arr => arr.sort((a, b) => (a.age - b.age) || (b.size - a.size)).slice(0, 5))
                .flat()
                .sort((a, b) => getResolutionRank(b.resolution) - getResolutionRank(a.resolution));

            // 7. Redis Cache Check (Pipeline)
            const getPipeline = redis.pipeline();
            const setPipeline = redis.pipeline();

            for (const r of filtered) {
                getPipeline.call("JSON.GET", `streams:${md5(r.downloadUrl)}`, "$.viewPath");
            }

            const cacheChecks = await getPipeline.exec();
            const streams: Stream[] = [];

            filtered.forEach((r, i) => {
                const hash = md5(r.downloadUrl);
                const key = `streams:${hash}`;

                // Parse Redis response (checking if viewPath exists)
                const cacheResult = cacheChecks?.[i]?.[1];
                const hasViewPath = Array.isArray(cacheResult) && cacheResult.length > 0 && cacheResult[0];
                const prefix = hasViewPath ? "⚡" : "";

                streams.push({
                    name: `${getResolutionIcon(r.resolution)} ${prefix} ${r.resolution}`,
                    title: r.lines,
                    url: `${ADDON_BASE_URL}/${Deno.env.get("ADDON_SHARED_SECRET")}/nzb/stream/${hash}`,
                    size: r.size,
                });

                if (!hasViewPath) {
                    setPipeline.call(
                        "JSON.SET", key, "$",
                        JSON.stringify({
                            downloadUrl: r.downloadUrl,
                            title: r.title,
                            size: r.size,
                            guid: extractGuidFromUrl(r.guid),
                            indexer: r.indexer,
                            type,
                            fileName: r.fileName,
                            rawImdbId: decoded,
                        }),
                        "NX"
                    );
                    setPipeline.expire(key, 60 * 60 * 48);
                }
            });

            await setPipeline.exec();
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

        if (apiKey !== Deno.env.get("ADDON_SHARED_SECRET")) {
            return jsonResponse({ error: "Unauthorized" }, 401);
        }

        if (!key) {
            return (await streamFailureVideo(req)) || jsonResponse({ error: "Missing key" }, 502);
        }

        console.log(`${method} Request made for ${key}`);
        try {
            return await streamNzbdavProxy(key, req);
        } catch (err) {
            console.error("NZBDAV proxy error:", err);
            return (await streamFailureVideo(req)) || jsonResponse({ error: "Upstream Error" }, 502);
        }
    }

    const proxyMatch = PATTERNS.nzbProxy.exec(url);
    if (proxyMatch && method === "GET") {
        const { hash } = proxyMatch.pathname.groups;
        const redisKey = `streams:${hash}`;
        const resolvedKey = `${redisKey}:resolved`;

        try {
            const dataRaw = await redis.call("JSON.GET", redisKey, "$");
            const data = parseRedisJson<{ downloadUrl?: string }>(dataRaw);

            if (!data?.downloadUrl) {
                return new Response("Unknown NZB hash or invalid record", { status: 404 });
            }

            let finalResponse: Response;
            const cachedResolvedUrl = await redis.get(resolvedKey);

            if (cachedResolvedUrl) {
                finalResponse = await fetch(cachedResolvedUrl);
            } else {
                const probeResp = await fetch(data.downloadUrl, { redirect: "manual" });

                if ([301, 302].includes(probeResp.status)) {
                    const location = probeResp.headers.get("location");
                    if (!location) return new Response("Redirect missing Location header", { status: 500 });
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

            const headers = new Headers(finalResponse.headers);
            headers.set("Content-Disposition", `attachment; filename="${hash}.nzb"`);

            if (!headers.get("content-type") || headers.get("content-type") === "application/octet-stream") {
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

function getResolutionRank(resolution: string): number {
    const r = resolution.toLowerCase();

    if (r.includes("4k") || r.includes("2160")) return 4;
    if (r.includes("1440") || r.includes("2k")) return 3;
    if (r.includes("1080")) return 2;
    if (r.includes("720")) return 1;

    return 0; // Unknown
}

function getResolutionIcon(resolution: string): string {
    const r = resolution.toLowerCase();

    if (r.includes("4k") || r.includes("2160")) return "🔥 4K UHD";
    if (r.includes("1440") || r.includes("2k")) return "🔥 2K";
    if (r.includes("1080")) return "🚀 FHD";
    if (r.includes("720")) return "💿 HD";

    return "💩 Unknown"; // Unknown
}

function extractGuidFromUrl(urlString: string): string | undefined {

    if (typeof NZBHYDRA_URL !== 'undefined' && NZBHYDRA_URL &&
        typeof NZBHYDRA_API_KEY !== 'undefined' && NZBHYDRA_API_KEY) {
        return urlString;
    }

    try {
        const url = new URL(urlString);

        const guidParam = url.searchParams.get("guid");
        if (guidParam) return guidParam;

        const pathSegments = url.pathname.split('/').filter(Boolean);
        return pathSegments.pop();

    } catch (_error: unknown) {
        return urlString;
    }
}


Deno.serve({ port: Number(PORT) }, handler);