import { join } from "@std/path/posix";
import { getMediaAndSearchResults } from "./utils/getMediaAndSearchResults.ts";

import { ADDON_BASE_URL, PORT, } from "./env.ts";
import { md5 } from "./utils/md5Encoder.ts";
import { streamNzbdavProxy } from "./lib/nzbDav/nzbDav.ts";
import { parseRequestedEpisode, type EpisodeInfo } from "./utils/parseRequestedEpisode.ts";
import { redis } from "./utils/redis.ts";

import { streamFailureVideo } from "./lib/streamFailureVideo.ts";
import { jsonResponse, textResponse } from "./utils/responseUtils.ts";

import { filenameParse as parseRelease } from "@ctrl/video-filename-parser";
import { formatVideoCard } from "./utils/streamFilters.ts";

async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

    if (method === "OPTIONS") {
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Range",
            "Access-Control-Max-Age": "86400",
        };
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (pathname === "/assets/icon.png" && method === "GET") {
        try {
            const iconPath = join(Deno.cwd(), "public", "assets", "icon.png");
            const file = await Deno.readFile(iconPath);
            return new Response(file, {
                headers: {
                    "Content-Type": "image/png",
                    "Cache-Control": "public, max-age=86400",
                    "Access-Control-Allow-Origin": "*", // Manual CORS
                },
            });
        } catch (err) {
            console.error("Failed to load icon.png:", err);
            return textResponse("Not found", 404);
        }
    }

    if (pathname === "/" && method === "GET") {
        return textResponse("Hello, the server is running! This is using the mkcfdc version of UsenetStreamer by Sanket9225.");
    }

    if (pathname.endsWith("/manifest.json") && method === "GET") {
        const expectedKeySegmentLength = pathname.length - "/manifest.json".length;
        const apiKeyFromPath = pathname.substring(1, expectedKeySegmentLength);

        if (apiKeyFromPath === Deno.env.get("ADDON_SHARED_SECRET")) {
            const manifest = {
                id: "com.usenet.streamer",
                version: "1.0.1",
                name: "UsenetStreamer",
                description:
                    "Usenet-powered instant streams for Stremio via Prowlarr and NZBDav",
                logo: `${ADDON_BASE_URL.replace(/\/$/, "")}/assets/icon.png`,
                resources: ["stream"],
                types: ["movie", "series"],
                catalogs: [],
                idPrefixes: ["tt"],
            };
            return jsonResponse(manifest);
        } else {
            return jsonResponse({ error: "Unauthorized" }, 401);
        }
    }

    const streamMatch = pathname.match(new RegExp(`^/([^/]+)/stream/(movie|series)/(.+)$`));
    if (streamMatch && method === "GET") {
        const apiKeyFromPath = streamMatch[1];
        const type = streamMatch[2] as "movie" | "series";
        const imdbId = streamMatch[3];

        if (apiKeyFromPath === Deno.env.get("ADDON_SHARED_SECRET")) {


            const decodedIdParam = decodeURIComponent(imdbId);

            const fullId = decodedIdParam.replace(".json", "");

            const requestedInfo = type === 'series' ? parseRequestedEpisode(type, fullId) ?? ({} as Partial<EpisodeInfo>) : { imdbid: fullId };

            console.log(`requestedInfo: ${JSON.stringify(requestedInfo)}`);

            try {
                const { results } = await getMediaAndSearchResults(type, requestedInfo);

                const getPipeline = redis.pipeline();
                results.forEach(r => {
                    const hash = md5(r.downloadUrl);
                    const streamKey = `streams:${hash}`;
                    getPipeline.call("JSON.GET", streamKey, "$");
                });
                const execResult = await getPipeline.exec() as any[] | null;
                const existingResults = execResult ?? [];

                const setPipeline = redis.pipeline();
                const streamsByResolution: { [key: string]: any[] } = {};  // Group streams by resolution

                const streams = results.map((r, idx) => {
                    const hash = md5(r.downloadUrl);
                    const streamKey = `streams:${hash}`;
                    const existingTuple = existingResults[idx];
                    const existingRaw = existingTuple && !existingTuple[0] ? existingTuple[1] : null;

                    let name = '';

                    if (existingRaw) {
                        try {
                            const data = JSON.parse(existingRaw)[0];
                            if (data?.viewPath) name = '⚡';
                        } catch {
                            // JSON parse failed, treat as NEW
                        }
                    } else {
                        const streamData = {
                            downloadUrl: r.downloadUrl,
                            title: r.title,
                            size: r.size,
                            fileName: r.fileName,
                            rawImdbId: fullId,
                        };

                        setPipeline.call("JSON.SET", streamKey, "$", JSON.stringify(streamData), "NX");
                        setPipeline.expire(streamKey, 60 * 60 * 48);
                    }

                    const parsedTitle = parseRelease(r.title, type === 'series');
                    const { resolution, lines } = formatVideoCard(parsedTitle, { size: (r.size / (1024 ** 3)).toFixed(2).replace(/\.?0+$/, ''), proxied: false, source: 'Usenet' });

                    // Group the streams by resolution
                    if (!streamsByResolution[resolution]) {
                        streamsByResolution[resolution] = [];
                    }

                    streamsByResolution[resolution].push({
                        name: name + ' ' + resolution,
                        title: lines,
                        url: `${ADDON_BASE_URL}/${Deno.env.get("ADDON_SHARED_SECRET")}/nzb/stream/${hash}`,
                        size: r.size,
                    });

                    return { resolution, size: r.size }; // Return resolution and size for sorting later
                });

                // Now, sort and limit the results per resolution
                const sortedStreams: any[] = [];
                for (const resolution in streamsByResolution) {
                    // Sort streams by size or other criteria you prefer
                    const sortedByResolution = streamsByResolution[resolution].sort((a, b) => b.size - a.size); // Example: sorting by size

                    // Limit to 5 streams per resolution
                    sortedStreams.push(...sortedByResolution.slice(0, 5));
                }

                await setPipeline.exec();
                return jsonResponse({ streams: sortedStreams });

            } catch (err) {
                console.error("Stream list error:", err);
                return jsonResponse({ error: "Failed to load streams" }, 502);
            }

        } else {
            return jsonResponse({ error: "Unauthorized" }, 401);
        }
    }

    if ((method === "GET" || method === "HEAD")) {
        const match = pathname.match(/^\/([^/]+)\/nzb\/stream\/([^/]+)$/);

        if (match) {
            // match[1] is the API Key from the path
            const apiKeyFromPath = match[1];
            // match[2] is the unique stream key (your 'key' variable)
            const key = match[2];

            // 1. Check the API Key
            if (apiKeyFromPath === Deno.env.get("ADDON_SHARED_SECRET")) {

                if (!key) {
                    const failureResponse = await streamFailureVideo(req);
                    if (failureResponse) return failureResponse;
                    return jsonResponse({ error: "Missing key" }, 502);
                }

                console.log(`${method} Request made for ${key}`);
                try {
                    return await streamNzbdavProxy(key, req);
                } catch (err) {
                    console.error("NZBDAV proxy error:", err);

                    const failureResponse = await streamFailureVideo(req);
                    if (failureResponse) return failureResponse;

                    if (method === "GET") {
                        return jsonResponse({ error: "UPSTREAM ERROR" }, 502);
                    } else { // HEAD
                        return jsonResponse({ error: "Failed to stream file" }, 502);
                    }
                }
            } else {
                return jsonResponse({ error: "Unauthorized" }, 401);
            }
        }
    }


    const proxyMatch = pathname.match(/^\/nzb\/proxy\/([a-f0-9]+)\.nzb$/i);
    if (proxyMatch && method === "GET") {
        if (!proxyMatch) {
            return new Response("Not Found", { status: 404 });
        }

        const hash = proxyMatch[1];
        const redisKey = `streams:${hash}`;
        const resolvedKey = `${redisKey}:resolved`;

        try {
            const dataRaw = await redis.call("JSON.GET", redisKey, "$");
            if (!dataRaw) {
                return new Response("Unknown NZB hash", { status: 404 });
            }

            let parsedData: any;
            if (typeof dataRaw === "string") {
                try {
                    parsedData = JSON.parse(dataRaw);
                } catch {
                    parsedData = dataRaw;
                }
            } else {
                parsedData = dataRaw;
            }

            const data = Array.isArray(parsedData) ? parsedData[0] : parsedData;
            if (!data?.downloadUrl) {
                return new Response("Invalid stream record", { status: 400 });
            }

            const downloadUrl: string = data.downloadUrl;
            let resolvedUrl: string | null = await redis.get(resolvedKey);

            if (!resolvedUrl) {
                const resp = await fetch(downloadUrl, { redirect: "manual" });
                if (![301, 302].includes(resp.status)) {
                    return new Response(`Unexpected Prowlarr status: ${resp.status}`, {
                        status: 500,
                    });
                }

                resolvedUrl = resp.headers.get("location");
                if (!resolvedUrl) {
                    return new Response("Redirect missing 'Location' header", { status: 500 });
                }

                await redis.setex(resolvedKey, 21600, resolvedUrl);
            }

            const nzbResp = await fetch(resolvedUrl);
            if (!nzbResp.ok) {
                if (nzbResp.status === 404) {
                    await redis.del(resolvedKey);
                }
                return new Response(await nzbResp.text(), { status: nzbResp.status });
            }

            const headers = new Headers(nzbResp.headers);
            headers.set("Content-Disposition", `attachment; filename="${hash}.nzb"`);
            headers.set("Content-Type", headers.get("content-type") ?? "application/x-nzb");

            return new Response(nzbResp.body, { headers });

        } catch (err) {
            console.error("[NZB Proxy] Error:", err);
            return new Response("Internal NZB proxy error", { status: 500 });
        }
    }

    return jsonResponse({ error: "Not found" }, 404);
}

Deno.serve({ port: Number(PORT) }, handler);