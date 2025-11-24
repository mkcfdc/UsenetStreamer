import { Config } from "../../env.ts";

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
            return Config.NZBDAV_CATEGORY_SERIES;
        case 'movie':
            return Config.NZBDAV_CATEGORY_MOVIES;
        default:
            return Config.NZBDAV_CATEGORY_DEFAULT;
    }
}

export function buildNzbdavApiParams(mode: string, extra: Record<string, string | number | boolean> = {}) {
    return {
        apikey: Config.NZBDAV_API_KEY,
        mode,
        ...extra,
        output: "json",
    };
}
