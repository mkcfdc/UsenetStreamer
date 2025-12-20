import { manifestRoute } from "./manifest.ts";
import { streamRoute } from "./stream.ts";
import { nzbStreamRoute } from "./nzbStream.ts";
import { nzbProxyRoute } from "./nzbProxy.ts";
import { staticIconRoute, staticIconRouteWithPrefix } from "./static.ts";
import type { RouteMatch } from "./types.ts";

export const routes: RouteMatch[] = [
    // Static assets first (most specific)
    staticIconRoute,
    staticIconRouteWithPrefix,

    // API routes
    manifestRoute,
    streamRoute,
    nzbStreamRoute,
    nzbProxyRoute,
];

export type { RouteMatch } from "./types.ts";
