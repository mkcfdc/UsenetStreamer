import { Config } from "../env.ts";
import { jsonResponse } from "../utils/responseUtils.ts";
import type { RouteMatch } from "./types.ts";

export const manifestRoute: RouteMatch = {
    pattern: new URLPattern({ pathname: "/:apiKey/manifest.json" }),
    methods: ["GET"],
    handler: async (_req: Request, match: URLPatternResult): Promise<Response> => {
        const apiKey = match.pathname.groups.apiKey;

        if (apiKey !== Config.ADDON_SHARED_SECRET) {
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
    },
};
