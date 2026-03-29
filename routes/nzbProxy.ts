import { redis } from "../utils/redis.ts";
import { parseRedisJson } from "../utils/streamHelpers.ts";
import type { RouteMatch } from "./types.ts";

// Set of explicit redirect status codes
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CACHE_TTL = 21600; // 6 hours

export const nzbProxyRoute: RouteMatch = {
    pattern: new URLPattern({ pathname: "/nzb/proxy/:hash.nzb" }),
    methods: ["GET"],
    handler: async (req: Request, match: URLPatternResult): Promise<Response> => {
        // match.pathname.groups values can technically be undefined in standard types
        const hash = match.pathname.groups.hash;
        if (!hash) return new Response("Missing hash", { status: 400 });

        const redisKey = `streams:${hash}`;
        const resolvedKey = `${redisKey}:resolved`;

        try {
            const [dataRaw, cachedResolvedUrl] = await Promise.all([
                redis.call("JSON.GET", redisKey, "$"),
                redis.get(resolvedKey),
            ]);

            const data = parseRedisJson<{ downloadUrl?: string }>(dataRaw);

            if (!data?.downloadUrl) {
                return new Response("Unknown NZB hash or invalid record", { status: 404 });
            }

            let finalResponse: Response;

            if (cachedResolvedUrl) {
                // Pass the signal so client disconnects abort the fetch
                finalResponse = await fetch(cachedResolvedUrl, { signal: req.signal });
            } else {
                const probeResp = await fetch(data.downloadUrl, {
                    redirect: "manual",
                    signal: req.signal
                });

                if (REDIRECT_STATUSES.has(probeResp.status)) {
                    const location = probeResp.headers.get("location");

                    // CRITICAL: Release the socket by canceling the unread body
                    await probeResp.body?.cancel();

                    if (!location) {
                        return new Response("Redirect missing Location header", { status: 502 });
                    }

                    // Handle potential relative redirects safely
                    const absoluteLocation = new URL(location, data.downloadUrl).toString();

                    await redis.setex(resolvedKey, CACHE_TTL, absoluteLocation);
                    finalResponse = await fetch(absoluteLocation, { signal: req.signal });

                } else if (probeResp.status === 200) {
                    finalResponse = probeResp;
                    await redis.setex(resolvedKey, CACHE_TTL, data.downloadUrl);

                } else {
                    // CRITICAL: Release the socket
                    await probeResp.body?.cancel();
                    return new Response(`Unexpected upstream status: ${probeResp.status}`, { status: 502 });
                }
            }

            if (!finalResponse.ok) {
                // Consider clearing the cache on 401, 403, and 410 as well as 404
                if ([401, 403, 404, 410].includes(finalResponse.status)) {
                    await redis.del(resolvedKey);
                }
                const errorText = await finalResponse.text(); // Reads and completes body
                return new Response(errorText, { status: finalResponse.status });
            }

            const headers = new Headers(finalResponse.headers);

            // SECURITY: Prevent upstream cookies from passing through to your users
            headers.delete("set-cookie");

            headers.set("Content-Disposition", `attachment; filename="${hash}.nzb"`);

            const cType = headers.get("content-type");
            if (!cType || cType === "application/octet-stream") {
                headers.set("Content-Type", "application/x-nzb");
            }

            return new Response(finalResponse.body, { headers });

        } catch (err: any) {
            // Gracefully handle the case where the client cancels the download
            if (err.name === "AbortError") {
                // 499 is the standard Client Closed Request code
                return new Response(null, { status: 499 });
            }

            console.error("[NZB Proxy] Error:", err);
            return new Response("Internal NZB proxy error", { status: 500 });
        }
    },
};
