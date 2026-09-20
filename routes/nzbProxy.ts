import { getRedis, parseRedisJson } from "../utils/redis.ts";
import { keys, RESOLVED_NZB_TTL_SEC } from "../utils/cacheKeys.ts";
import type { RouteMatch } from "./types.ts";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const nzbProxyRoute: RouteMatch = {
    pattern: new URLPattern({ pathname: "/nzb/proxy/:hash.nzb" }),
    methods: ["GET"],
    handler: async (req: Request, match: URLPatternResult): Promise<Response> => {
        const hash = match.pathname.groups.hash;
        if (!hash) return new Response("Missing hash", { status: 400 });

        const redisKey = keys.stream(hash);
        const resolvedKey = keys.streamResolved(hash);
        const redis = getRedis();

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
                finalResponse = await fetch(cachedResolvedUrl, { signal: req.signal });
            } else {
                const probeResp = await fetch(data.downloadUrl, {
                    redirect: "manual",
                    signal: req.signal
                });

                if (REDIRECT_STATUSES.has(probeResp.status)) {
                    const location = probeResp.headers.get("location");
                    await probeResp.body?.cancel();

                    if (!location) {
                        return new Response("Redirect missing Location header", { status: 502 });
                    }

                    const absoluteLocation = new URL(location, data.downloadUrl).toString();
                    await redis.setex(resolvedKey, RESOLVED_NZB_TTL_SEC, absoluteLocation);
                    finalResponse = await fetch(absoluteLocation, { signal: req.signal });
                } else if (probeResp.status === 200) {
                    finalResponse = probeResp;
                    await redis.setex(resolvedKey, RESOLVED_NZB_TTL_SEC, data.downloadUrl);
                } else {
                    await probeResp.body?.cancel();
                    return new Response(`Unexpected upstream status: ${probeResp.status}`, { status: 502 });
                }
            }

            if (!finalResponse.ok) {
                if ([401, 403, 404, 410].includes(finalResponse.status)) {
                    await redis.del(resolvedKey);
                }
                const errorText = await finalResponse.text();
                return new Response(errorText, { status: finalResponse.status });
            }

            const headers = new Headers(finalResponse.headers);
            headers.delete("set-cookie");
            headers.set("Content-Disposition", `attachment; filename="${hash}.nzb"`);

            const cType = headers.get("content-type");
            if (!cType || cType === "application/octet-stream") {
                headers.set("Content-Type", "application/x-nzb");
            }

            return new Response(finalResponse.body, { headers });
        } catch (err: any) {
            if (err.name === "AbortError") {
                return new Response(null, { status: 499 });
            }
            console.error("[NZB Proxy] Error:", err);
            return new Response("Internal NZB proxy error", { status: 500 });
        }
    },
};
