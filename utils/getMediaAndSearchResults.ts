import { redis } from "./redis.ts";
import { getCinemetaData } from "../lib/cinemeta.ts";
import { searchHydra } from "../lib/nzbhydra.ts";
import { searchProwlarr } from "../lib/prowlarr.ts";
import { searchDirect } from "../lib/nzbnab.ts";
import { Config } from "../env.ts";
import { LRUCache } from "lru-cache";

interface RequestedEpisode {
    imdbid?: string;
    season?: number;
    episode?: number;
}

interface CinemetaData {
    name: string;
    year: string;
    tvdbId?: string;
    tmdbId?: string;
}

export interface SearchResult {
    guid: string | null;
    fileId?: string;
    title: string;
    downloadUrl: string;
    size: number;
    fileName?: string;
    category?: string;
    indexer?: string;
    age?: number;
    grabs?: number;
    protocol?: string;
}

interface RawSearchResult {
    guid: string | null;
    title: string;
    downloadUrl: string;
    size: number;
    indexer?: string;
    age?: number;
}

// --- CONSTANTS ---
const CINEMETA_CACHE_TTL = 604800;
const SEARCH_CACHE_TTL = 86400;
const CINEMETA_INFLIGHT_TTL_SEC = 20;
const SEARCH_INFLIGHT_TTL_SEC = 25;
const PROTOCOL_USENET = "usenet";

// Provider determined once at startup
const PROVIDER: "hydra" | "prowlarr" | "direct" =
    (Config.NZBHYDRA_URL && Config.NZBHYDRA_API_KEY) ? "hydra" :
        (Config.PROWLARR_URL && Config.PROWLARR_API_KEY) ? "prowlarr" : "direct";

// --- CACHES ---
// L1: In-memory LRU (microseconds)
// Using union type of all cached value types
type CacheValue = CinemetaData | SearchResult[];

const l1Cache = new LRUCache<string, CacheValue>({
    max: 1000,
    ttl: 120_000,
});

// L2: Inflight deduplication (prevents thundering herd)
const inflight = new Map<string, Promise<CacheValue>>();

// --- HELPERS ---
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function parseRedisJson<T>(raw: unknown): T | undefined {
    if (!raw) return undefined;
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed[0] ?? undefined : parsed;
    } catch {
        return undefined;
    }
}

function getOrCompute<T extends CacheValue>(
    key: string,
    inflightTtl: number,
    redisTtl: number,
    compute: () => Promise<T>,
): Promise<T> {
    // L1: Memory check (< 1μs)
    const l1 = l1Cache.get(key);
    if (l1 !== undefined) return Promise.resolve(l1 as T);

    // Dedupe: Join existing computation
    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;

    // Create work promise
    const work = (async (): Promise<T> => {
        // L2: Redis check
        const cached = parseRedisJson<T>(await redis.call("JSON.GET", key, "$"));
        if (cached !== undefined) {
            l1Cache.set(key, cached);
            return cached;
        }

        // Acquire lock
        const lockKey = `${key}:lock`;
        const gotLock = await redis.set(lockKey, "1", "EX", inflightTtl, "NX") === "OK";

        if (gotLock) {
            try {
                // Double-check after lock
                const rechecked = parseRedisJson<T>(await redis.call("JSON.GET", key, "$"));
                if (rechecked !== undefined) {
                    l1Cache.set(key, rechecked);
                    return rechecked;
                }

                // Compute
                const result = await compute();

                // Cache L1 + L2 (fire-and-forget Redis)
                l1Cache.set(key, result);
                redis.call("JSON.SET", key, "$", JSON.stringify(result))
                    .then(() => redis.expire(key, redisTtl))
                    .catch(() => { });

                return result;
            } finally {
                redis.del(lockKey).catch(() => { });
            }
        }

        // Wait for another worker
        const deadline = Date.now() + inflightTtl * 1000;
        let backoff = 80;

        while (Date.now() < deadline) {
            await delay(backoff);

            // Check L1 first (other worker may have populated it)
            const l1Check = l1Cache.get(key);
            if (l1Check !== undefined) return l1Check as T;

            const v = parseRedisJson<T>(await redis.call("JSON.GET", key, "$"));
            if (v !== undefined) {
                l1Cache.set(key, v);
                return v;
            }

            backoff = Math.min(backoff * 1.5 | 0, 400);
        }

        // Fallback: compute ourselves
        const result = await compute();
        l1Cache.set(key, result);
        return result;
    })();

    inflight.set(key, work);
    work.finally(() => inflight.delete(key));

    return work;
}

// --- RESULT MAPPER ---
function mapToSearchResult(r: RawSearchResult): SearchResult {
    return {
        guid: r.guid,
        title: r.title,
        downloadUrl: r.downloadUrl,
        size: r.size,
        indexer: r.indexer,
        age: r.age,
        protocol: PROTOCOL_USENET,
        fileName: r.title,
    };
}

export async function getMediaAndSearchResults(
    type: "movie" | "series",
    episodeInfo: RequestedEpisode,
): Promise<{ cinemetaData: CinemetaData; results: SearchResult[] }> {
    const { imdbid: imdbId, season, episode } = episodeInfo;
    if (!imdbId) throw new Error("IMDB ID is required");

    const cinemetaKey = `cinemeta:${type}:${imdbId}`;
    const searchKey = (season && episode)
        ? `search:${imdbId}:${season}:${episode}`
        : `search:${imdbId}`;

    // L1: Check memory first for both
    const l1Meta = l1Cache.get(cinemetaKey) as CinemetaData | undefined;
    const l1Results = l1Cache.get(searchKey) as SearchResult[] | undefined;

    if (l1Meta && l1Results) {
        return { cinemetaData: l1Meta, results: l1Results };
    }

    // L2: Pipeline Redis check for missing keys
    let cachedMeta: CinemetaData | undefined = l1Meta;
    let cachedResults: SearchResult[] | undefined = l1Results;

    if (!l1Meta || !l1Results) {
        const pipeline = redis.pipeline();
        if (!l1Meta) pipeline.call("JSON.GET", cinemetaKey, "$");
        if (!l1Results) pipeline.call("JSON.GET", searchKey, "$");

        const pipeResults = await pipeline.exec();

        if (pipeResults) {
            let idx = 0;

            if (!l1Meta) {
                const parsed = parseRedisJson<CinemetaData>(pipeResults[idx++]?.[1]);
                if (parsed) {
                    cachedMeta = parsed;
                    l1Cache.set(cinemetaKey, parsed);
                }
            }
            if (!l1Results) {
                const parsed = parseRedisJson<SearchResult[]>(pipeResults[idx]?.[1]);
                if (parsed) {
                    cachedResults = parsed;
                    l1Cache.set(searchKey, parsed);
                }
            }
        }
    }

    // Fast path: both cached
    if (cachedMeta && cachedResults) {
        return { cinemetaData: cachedMeta, results: cachedResults };
    }

    // Get cinemeta
    const cinemetaData = cachedMeta ?? await getOrCompute<CinemetaData>(
        cinemetaKey,
        CINEMETA_INFLIGHT_TTL_SEC,
        CINEMETA_CACHE_TTL,
        () => getCinemetaData(type, imdbId) as Promise<CinemetaData>,
    );

    // Fast path: only search missing
    if (cachedResults) {
        return { cinemetaData, results: cachedResults };
    }

    // Get search results
    const results = await getOrCompute<SearchResult[]>(
        searchKey,
        SEARCH_INFLIGHT_TTL_SEC,
        SEARCH_CACHE_TTL,
        async () => {
            const opts = {
                imdbId,
                tvdbId: cinemetaData.tvdbId,
                tmdbId: cinemetaData.tmdbId,
                name: cinemetaData.name,
                year: String(cinemetaData.year),
                type,
                limit: 50,
                season,
                episode,
            };

            let raw: RawSearchResult[];

            switch (PROVIDER) {
                case "hydra":
                    raw = await searchHydra(opts) as RawSearchResult[];
                    break;
                case "prowlarr":
                    return searchProwlarr(opts) as Promise<SearchResult[]>;
                default:
                    raw = await searchDirect(opts) as RawSearchResult[];
            }

            // Pre-allocated mapping
            const out = new Array<SearchResult>(raw.length);
            for (let i = 0; i < raw.length; i++) {
                out[i] = mapToSearchResult(raw[i]);
            }
            return out;
        },
    );

    return { cinemetaData, results };
}
