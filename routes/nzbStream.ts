import { Config } from "../env.ts";
import { jsonResponse } from "../utils/responseUtils.ts";
import { streamNzbdavProxy } from "../lib/nzbDav/nzbDav.ts";
import { streamFailureVideo } from "../lib/streamFailureVideo.ts";
import type { RouteMatch } from "./types.ts";

export const nzbStreamRoute: RouteMatch = {
    pattern: new URLPattern({ pathname: "/:apiKey/nzb/stream/:key" }),
    methods: ["GET", "HEAD"],
    handler: async (req: Request, match: URLPatternResult): Promise<Response> => {
        const { apiKey, key } = match.pathname.groups;

        if (apiKey !== Config.ADDON_SHARED_SECRET) {
            return jsonResponse({ error: "Unauthorized" }, 401);
        }

        if (!key) {
            return (await streamFailureVideo(req)) || jsonResponse({ error: "Missing key" }, 502);
        }

        try {
            return await streamNzbdavProxy(key, req);
        } catch (err) {
            console.error("NZBDAV proxy error:", err);
            return (await streamFailureVideo(req)) || jsonResponse({ error: "Upstream Error" }, 502);
        }
    },
};
