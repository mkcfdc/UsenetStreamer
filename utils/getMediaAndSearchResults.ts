import { redis, getJsonValue, setJsonValue } from "./redis.ts";
import { getCinemetaData } from "../lib/cinemeta.ts";
import { searchHydra } from "../lib/nzbhydra.ts";
import { searchProwlarr } from "../lib/prowlarr.ts";
import { searchDirect } from "../lib/nzbnab.ts";
import { Config } from "../env.ts";

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

const CINEMETA_CACHE_TTL = 86400 * 7;
const SEARCH_CACHE_TTL = 86400; // 1 day

const CINEMETA_INFLIGHT_TTL_SEC = 20;
const SEARCH_INFLIGHT_TTL_SEC = 25;

function buildSearchKey(imdbId: string, season?: number, episode?: number): string {
    return (season && episode) ? `search:${imdbId}:${season}:${episode}` : `search:${imdbId}`;
}

function provider(): "hydra" | "prowlarr" | "direct" {
    if (Config.NZBHYDRA_URL && Config.NZBHYDRA_API_KEY) return "hydra";
    if (Config.PROWLARR_URL && Config.PROWLARR_API_KEY) return "prowlarr";
    return "direct";
}

async function delay(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
}

async function getOrComputeWithInflightLock<T>(
    dataKey: string,
    inflightTtlSec: number,
    compute: () => Promise<T>,
): Promise<T> {
    const cached = await getJsonValue<T>(dataKey);
    if (cached) return cached;

    const lockKey = `${dataKey}:inflight`;
    const lockOk = await (redis as any).set(lockKey, "1", "EX", inflightTtlSec, "NX");

    if (lockOk === "OK") {
        try {
            const cachedAfterLock = await getJsonValue<T>(dataKey);
            if (cachedAfterLock) return cachedAfterLock;
            return await compute();
        } finally {
            redis.del(lockKey).catch(() => { });
        }
    }

    const deadline = Date.now() + inflightTtlSec * 1000;
    let backoff = 110;

    while (Date.now() < deadline) {
        const v = await getJsonValue<T>(dataKey);
        if (v) return v;

        await delay(backoff);
        backoff = Math.min(Math.floor(backoff * 1.35), 600);
    }

    return await compute();
}

export async function getMediaAndSearchResults(
    type: "movie" | "series",
    episodeInfo: RequestedEpisode,
): Promise<{ cinemetaData: CinemetaData; results: SearchResult[] }> {
    const { imdbid: imdbId, season, episode } = episodeInfo;
    if (!imdbId) throw new Error("IMDB ID is required");

    const cinemetaKey = `cinemeta:${type}:${imdbId}`;
    const searchKey = buildSearchKey(imdbId, season, episode);

    const [cachedMeta, cachedResults] = await Promise.all([
        getJsonValue<CinemetaData>(cinemetaKey),
        getJsonValue<SearchResult[]>(searchKey),
    ]);

    if (cachedMeta && cachedResults) return { cinemetaData: cachedMeta, results: cachedResults };

    const cinemetaData = cachedMeta ?? await getOrComputeWithInflightLock<CinemetaData>(
        cinemetaKey,
        CINEMETA_INFLIGHT_TTL_SEC,
        async () => {
            const data = await getCinemetaData(type, imdbId) as CinemetaData;
            setJsonValue(cinemetaKey, "$", data, CINEMETA_CACHE_TTL).catch(() => { });
            return data;
        },
    );

    if (cachedResults) return { cinemetaData, results: cachedResults };

    const results = await getOrComputeWithInflightLock<SearchResult[]>(
        searchKey,
        SEARCH_INFLIGHT_TTL_SEC,
        async () => {
            const searchOptions = {
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

            const p = provider();

            let out: SearchResult[] = [];
            if (p === "hydra") {
                const hydraResults = await searchHydra(searchOptions);
                out = hydraResults.map((h) => ({
                    guid: h.guid,
                    title: h.title,
                    downloadUrl: h.downloadUrl,
                    size: h.size,
                    indexer: h.indexer,
                    age: h.age,
                    protocol: "usenet",
                    fileName: h.title,
                }));
            } else if (p === "prowlarr") {
                out = await searchProwlarr(searchOptions) as SearchResult[];
            } else {
                const directResults = await searchDirect(searchOptions);
                out = directResults.map((r) => ({
                    guid: r.guid,
                    title: r.title,
                    downloadUrl: r.downloadUrl,
                    size: r.size,
                    indexer: r.indexer,
                    age: r.age,
                    protocol: "usenet",
                    fileName: r.title,
                }));
            }

            setJsonValue(searchKey, "$", out, SEARCH_CACHE_TTL).catch(() => { });
            return out;
        },
    );

    return { cinemetaData, results };
}
