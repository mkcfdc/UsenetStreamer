/** Central Redis key layout. Keep every cache key in one place. */

export const STREAM_TTL_SEC = 172_800; // 2 days
export const RESOLVED_NZB_TTL_SEC = 21_600; // 6 hours
export const FAILED_STREAM_TTL_SEC = 300;
export const CINEMETA_TTL_SEC = 604_800; // 7 days
export const SEARCH_TTL_SEC = 86_400; // 1 day
export const SESSION_TTL_SEC = 86_400;

export const keys = {
    stream: (hash: string) => `streams:${hash}`,
    streamResolved: (hash: string) => `streams:${hash}:resolved`,
    streamFailed: (hash: string) => `failed:${hash}`,
    streamLock: (hash: string) => `lock:stream:${hash}`,
    streamChannel: (cacheKey: string) => `channel:stream:${cacheKey}`,
    cinemeta: (type: string, id: string) => `cinemeta:${type}:${id}`,
    search: (id: string, season?: number, episode?: number) =>
        season && episode ? `search:${id}:${season}:${episode}` : `search:${id}`,
    searchLock: (searchKey: string) => `${searchKey}:lock`,
    session: (sessionId: string) => `session:${sessionId}`,
} as const;
