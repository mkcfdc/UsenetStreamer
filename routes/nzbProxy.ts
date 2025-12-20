import { redis } from "../utils/redis.ts";
import { parseRedisJson } from "../utils/streamHelpers.ts";
import type { RouteMatch } from "./types.ts";

export const nzbProxyRoute: RouteMatch = {
    pattern: new URLPattern({ pathname: "/nzb/proxy/:hash.nzb" }),
    methods: ["GET"],
    handler: async (_req: Request, match: URLPatternResult): Promise<Response> => {
        const { hash } = match.pathname.groups;
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
                finalResponse = await fetch(cachedResolvedUrl);
            } else {
                const probeResp = await fetch(data.downloadUrl, { redirect: "manual" });

                if (probeResp.status >= 300 && probeResp.status < 400) {
                    const location = probeResp.headers.get("location");
                    if (!location) {
                        return new Response("Redirect missing Location header", { status: 502 });
                    }

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

            const cType = headers.get("content-type");
            if (!cType || cType === "application/octet-stream") {
                headers.set("Content-Type", "application/x-nzb");
            }

            return new Response(finalResponse.body, { headers });
        } catch (err) {
            console.error("[NZB Proxy] Error:", err);
            return new Response("Internal NZB proxy error", { status: 500 });
        }
    },
};
