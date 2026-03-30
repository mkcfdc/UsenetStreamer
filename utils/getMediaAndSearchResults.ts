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
    imdbId?: string;
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

// --- CONSTANTS & CONFIG ---
const CINEMETA_CACHE_TTL = 604800;
const SEARCH_CACHE_TTL = 86400;
const CINEMETA_INFLIGHT_TTL_SEC = 20;
const SEARCH_INFLIGHT_TTL_SEC = 25;
const PROTOCOL_USENET = "usenet";

const PROVIDER: "hydra" | "prowlarr" | "direct" =
    (Config.NZBHYDRA_URL && Config.NZBHYDRA_API_KEY) ? "hydra" :
        (Config.PROWLARR_URL && Config.PROWLARR_API_KEY) ? "prowlarr" : "direct";

const SAFE_UNLOCK_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
    else
        return 0
    end
`;

// --- CACHES ---
type CacheValue = CinemetaData | SearchResult[];

const l1Cache = new LRUCache<string, CacheValue>({
    max: 1000,
    ttl: 120_000,
});

const inflight = new Map<string, Promise<CacheValue>>();

// --- HELPERS ---
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function parseRedisJson<T>(raw: unknown): T | undefined {
    if (!raw || typeof raw !== "string") return undefined;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed[0] ?? undefined : parsed;
    } catch {
        return undefined;
    }
}

/**
 * Highly optimized caching wrapper. 
 * Includes multi-process Thundering Herd protection via Tokenized Distributed Locks.
 */
function getOrCompute<T extends CacheValue>(
    key: string,
    inflightTtl: number,
    redisTtl: number,
    l2AlreadyChecked: boolean, // Optimization: Bypasses redundant L2 check if we already MGET'd it
    compute: () => Promise<T>,
): Promise<T> {
    const l1 = l1Cache.get(key);
    if (l1 !== undefined) return Promise.resolve(l1 as T);

    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;

    const work = (async (): Promise<T> => {
        if (!l2AlreadyChecked) {
            const cached = parseRedisJson<T>(await redis.call("JSON.GET", key, "$"));
            if (cached !== undefined) {
                l1Cache.set(key, cached);
                return cached;
            }
        }

        const lockKey = `${key}:lock`;
        const token = crypto.randomUUID(); // Prevents deleting another worker's lock
        const gotLock = await redis.set(lockKey, token, "EX", inflightTtl, "NX") === "OK";

        if (gotLock) {
            try {
                // Double-check cache in case the previous lock holder just finished
                const rechecked = parseRedisJson<T>(await redis.call("JSON.GET", key, "$"));
                if (rechecked !== undefined) {
                    l1Cache.set(key, rechecked);
                    return rechecked;
                }

                const result = await compute();

                l1Cache.set(key, result);
                redis.call("JSON.SET", key, "$", JSON.stringify(result))
                    .then(() => redis.expire(key, redisTtl))
                    .catch(() => { });

                return result;
            } finally {
                // Only release the lock if we still own it
                redis.eval(SAFE_UNLOCK_SCRIPT, 1, lockKey, token).catch(() => { });
            }
        }

        // Spin-lock Wait: Another worker holds the lock, wait for them to populate the cache
        const deadline = Date.now() + inflightTtl * 1000;
        let backoff = 80;

        while (Date.now() < deadline) {
            await delay(backoff);

            const l1Check = l1Cache.get(key);
            if (l1Check !== undefined) return l1Check as T;

            const v = parseRedisJson<T>(await redis.call("JSON.GET", key, "$"));
            if (v !== undefined) {
                l1Cache.set(key, v);
                return v;
            }

            backoff = Math.min(backoff * 1.5 | 0, 400);
        }

        // Fallback: If the lock holder died/timed out, compute it ourselves
        const result = await compute();
        l1Cache.set(key, result);
        return result;
    })();

    inflight.set(key, work);
    work.finally(() => inflight.delete(key));

    return work;
}

// --- TMDB FETCH LOGIC ---
async function getTmdbData(type: "movie" | "series", tmdbIdFull: string): Promise<CinemetaData> {
    // V8 Optimization: .slice is vastly faster than .replace() with a regex engine allocation
    const tmdbId = tmdbIdFull.slice(5);
    const apiKey = Config.TMDB_API_KEY;

    if (!apiKey) throw new Error("TMDB_API_KEY is missing in env.ts.");

    const endpoint = type === "movie" ? `movie/${tmdbId}` : `tv/${tmdbId}`;
    const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${apiKey}&append_to_response=external_ids`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB API Error: ${res.status} ${res.statusText}`);

    const data = await res.json();
    const externalIds = data.external_ids || {};

    return {
        name: (type === "movie" ? data.title : data.name) || "Unknown",
        // Safely extract year natively without closures
        year: (type === "movie" ? data.release_date : data.first_air_date)?.slice(0, 4) || "",
        tmdbId: tmdbId,
        tvdbId: externalIds.tvdb_id ? String(externalIds.tvdb_id) : undefined,
        imdbId: (externalIds.imdb_id || data.imdb_id) ? String(externalIds.imdb_id || data.imdb_id) : undefined,
    };
}

export async function getMediaAndSearchResults(
    type: "movie" | "series",
    episodeInfo: RequestedEpisode,
): Promise<{ cinemetaData: CinemetaData; results: SearchResult[] }> {
    const { imdbid: requestedId, season, episode } = episodeInfo;
    if (!requestedId) throw new Error("An ID is required");

    const isTmdb = requestedId.startsWith("tmdb:");
    const cinemetaKey = `cinemeta:${type}:${requestedId}`;
    const searchKey = (season && episode)
        ? `search:${requestedId}:${season}:${episode}`
        : `search:${requestedId}`;

    // L1 Memory Check
    let l1Meta = l1Cache.get(cinemetaKey) as CinemetaData | undefined;
    let l1Results = l1Cache.get(searchKey) as SearchResult[] | undefined;

    // L2 Redis Check via JSON.MGET (Faster than Pipeline)
    if (!l1Meta || !l1Results) {
        const keysToFetch: string[] = [];
        if (!l1Meta) keysToFetch.push(cinemetaKey);
        if (!l1Results) keysToFetch.push(searchKey);

        if (keysToFetch.length > 0) {
            const mgetRes = await redis.call("JSON.MGET", ...keysToFetch, "$") as (string | null)[];

            let i = 0;
            if (!l1Meta) {
                const parsed = parseRedisJson<CinemetaData>(mgetRes[i++]);
                if (parsed) { l1Meta = parsed; l1Cache.set(cinemetaKey, parsed); }
            }
            if (!l1Results) {
                const parsed = parseRedisJson<SearchResult[]>(mgetRes[i++]);
                if (parsed) { l1Results = parsed; l1Cache.set(searchKey, parsed); }
            }
        }
    }

    // Pass `true` for l2AlreadyChecked since we just executed MGET.
    const cinemetaData = l1Meta ?? await getOrCompute<CinemetaData>(
        cinemetaKey,
        CINEMETA_INFLIGHT_TTL_SEC,
        CINEMETA_CACHE_TTL,
        true,
        () => isTmdb ? getTmdbData(type, requestedId) : getCinemetaData(type, requestedId) as Promise<CinemetaData>
    );

    const results = l1Results ?? await getOrCompute<SearchResult[]>(
        searchKey,
        SEARCH_INFLIGHT_TTL_SEC,
        SEARCH_CACHE_TTL,
        true,
        async () => {
            const resolvedImdbId = isTmdb ? cinemetaData.imdbId : requestedId;
            const resolvedTmdbId = cinemetaData.tmdbId || (isTmdb ? requestedId.slice(5) : undefined);

            const opts = {
                imdbId: resolvedImdbId,
                tvdbId: cinemetaData.tvdbId,
                tmdbId: resolvedTmdbId,
                name: cinemetaData.name,
                year: cinemetaData.year ? String(cinemetaData.year) : undefined,
                type,
                limit: 50,
                season,
                episode,
            };

            let raw: RawSearchResult[];
            if (PROVIDER === "hydra") {
                raw = await searchHydra(opts) as RawSearchResult[];
            } else if (PROVIDER === "prowlarr") {
                return searchProwlarr(opts) as Promise<SearchResult[]>;
            } else {
                raw = await searchDirect(opts) as RawSearchResult[];
            }

            // High performance manual mapping loop (beats Array.prototype.map in V8)
            const out = new Array<SearchResult>(raw.length);
            for (let i = 0; i < raw.length; i++) {
                const r = raw[i];
                out[i] = {
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
            return out;
        },
    );

    return { cinemetaData, results };
}
