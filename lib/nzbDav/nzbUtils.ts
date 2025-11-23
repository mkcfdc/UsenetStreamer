import { NZBDAV_CATEGORY_DEFAULT, NZBDAV_CATEGORY_MOVIES, NZBDAV_CATEGORY_SERIES, NZBDAV_API_KEY } from "../../env.ts";

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));

    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), ms);

        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
    });
}

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
