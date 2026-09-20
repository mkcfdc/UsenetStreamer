import { getCinemetaData } from "../lib/cinemeta.ts";
import { searchHydra } from "../lib/nzbhydra.ts";
import { searchProwlarr } from "../lib/prowlarr.ts";
import { searchDirect } from "../lib/nzbnab.ts";
import { Config, searchProvider } from "../env.ts";
import { LRUCache } from "lru-cache";
import { CINEMETA_TTL_SEC, keys, SEARCH_TTL_SEC } from "./cacheKeys.ts";
import {
    acquireLock,
    getJsonValue,
    getJsonValues,
    releaseLock,
    setJsonValue,
} from "./redis.ts";

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

const CINEMETA_LOCK_SEC = 20;
const SEARCH_LOCK_SEC = 25;
const PROTOCOL_USENET = "usenet";

type CacheValue = CinemetaData | SearchResult[];

const l1Cache = new LRUCache<string, CacheValue>({
    max: 1000,
    ttl: 120_000,
});

const inflight = new Map<string, Promise<CacheValue>>();

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function remember<T extends CacheValue>(key: string, value: T): T {
    l1Cache.set(key, value);
    return value;
}

export function invalidateSearchCache(searchKey: string): void {
    l1Cache.delete(searchKey);
}

async function persist<T extends CacheValue>(key: string, value: T, ttl: number): Promise<void> {
    await setJsonValue(key, "$", value, ttl);
}

function getOrCompute<T extends CacheValue>(
    key: string,
    lockTtlSec: number,
    redisTtl: number,
    l2AlreadyChecked: boolean,
    compute: () => Promise<T>,
): Promise<T> {
    const hit = l1Cache.get(key);
    if (hit !== undefined) return Promise.resolve(hit as T);

    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;

    const work = (async (): Promise<T> => {
        if (!l2AlreadyChecked) {
            const cached = await getJsonValue<T>(key);
            if (cached !== undefined) return remember(key, cached);
        }

        const lockKey = keys.searchLock(key);
        const token = crypto.randomUUID();
        const gotLock = await acquireLock(lockKey, lockTtlSec * 1000, token);

        if (gotLock) {
            try {
                const again = await getJsonValue<T>(key);
                if (again !== undefined) return remember(key, again);

                const result = await compute();
                remember(key, result);
                persist(key, result, redisTtl).catch(() => {});
                return result;
            } finally {
                await releaseLock(lockKey, token);
            }
        }

        const deadline = Date.now() + lockTtlSec * 1000;
        let backoff = 80;
        while (Date.now() < deadline) {
            await delay(backoff);
            const local = l1Cache.get(key);
            if (local !== undefined) return local as T;
            const remote = await getJsonValue<T>(key);
            if (remote !== undefined) return remember(key, remote);
            backoff = Math.min((backoff * 1.5) | 0, 400);
        }

        const fallback = await compute();
        remember(key, fallback);
        persist(key, fallback, redisTtl).catch(() => {});
        return fallback;
    })();

    inflight.set(key, work);
    work.finally(() => inflight.delete(key));
    return work;
}

async function getTmdbData(type: "movie" | "series", tmdbIdFull: string): Promise<CinemetaData> {
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
        year: (type === "movie" ? data.release_date : data.first_air_date)?.slice(0, 4) || "",
        tmdbId,
        tvdbId: externalIds.tvdb_id ? String(externalIds.tvdb_id) : undefined,
        imdbId: (externalIds.imdb_id || data.imdb_id)
            ? String(externalIds.imdb_id || data.imdb_id)
            : undefined,
    };
}

export async function getMediaAndSearchResults(
    type: "movie" | "series",
    episodeInfo: RequestedEpisode,
): Promise<{ cinemetaData: CinemetaData; results: SearchResult[]; searchKey: string }> {
    const { imdbid: requestedId, season, episode } = episodeInfo;
    if (!requestedId) throw new Error("An ID is required");

    const isTmdb = requestedId.startsWith("tmdb:");
    const cinemetaKey = keys.cinemeta(type, requestedId);
    const searchKey = keys.search(requestedId, season, episode);

    let meta = l1Cache.get(cinemetaKey) as CinemetaData | undefined;
    let results = l1Cache.get(searchKey) as SearchResult[] | undefined;

    if (!meta || !results) {
        const fetchKeys: string[] = [];
        if (!meta) fetchKeys.push(cinemetaKey);
        if (!results) fetchKeys.push(searchKey);

        if (fetchKeys.length > 0) {
            const remote = await getJsonValues<CacheValue>(fetchKeys);
            let i = 0;
            if (!meta) {
                const parsed = remote[i++] as CinemetaData | undefined;
                if (parsed) meta = remember(cinemetaKey, parsed);
            }
            if (!results) {
                const parsed = remote[i++] as SearchResult[] | undefined;
                if (parsed) results = remember(searchKey, parsed);
            }
        }
    }

    const cinemetaData = meta ?? await getOrCompute<CinemetaData>(
        cinemetaKey,
        CINEMETA_LOCK_SEC,
        CINEMETA_TTL_SEC,
        true,
        () => isTmdb
            ? getTmdbData(type, requestedId)
            : getCinemetaData(type, requestedId) as Promise<CinemetaData>,
    );

    const searchResults = results ?? await getOrCompute<SearchResult[]>(
        searchKey,
        SEARCH_LOCK_SEC,
        SEARCH_TTL_SEC,
        true,
        async () => {
            const opts = {
                imdbId: isTmdb ? cinemetaData.imdbId : requestedId,
                tvdbId: cinemetaData.tvdbId,
                tmdbId: cinemetaData.tmdbId || (isTmdb ? requestedId.slice(5) : undefined),
                name: cinemetaData.name,
                year: cinemetaData.year ? String(cinemetaData.year) : undefined,
                type,
                limit: 50,
                season,
                episode,
            };

            const provider = searchProvider();
            if (provider === "prowlarr") {
                return searchProwlarr(opts) as Promise<SearchResult[]>;
            }

            const raw = (provider === "hydra"
                ? await searchHydra(opts)
                : await searchDirect(opts)) as RawSearchResult[];

            return raw.map((r) => ({
                guid: r.guid,
                title: r.title,
                downloadUrl: r.downloadUrl,
                size: r.size,
                indexer: r.indexer,
                age: r.age,
                protocol: PROTOCOL_USENET,
                fileName: r.title,
            }));
        },
    );

    return { cinemetaData, results: searchResults, searchKey };
}
