import { NZBDAV_CATEGORY_DEFAULT, NZBDAV_CATEGORY_MOVIES, NZBDAV_CATEGORY_SERIES, NZBDAV_API_KEY } from "../../env.ts";

export const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

export function getNzbdavCategory(type?: string): string {
    switch (type?.toLowerCase()) {
        case 'series':
        case 'tv':
            return NZBDAV_CATEGORY_SERIES;
        case 'movie':
            return NZBDAV_CATEGORY_MOVIES;
        default:
            return NZBDAV_CATEGORY_DEFAULT;
    }
}

export function buildNzbdavApiParams(mode: string, extra: Record<string, string | number | boolean> = {}) {
    return {
        apikey: NZBDAV_API_KEY,
        mode,
        ...extra,
        output: "json",
    };
}
