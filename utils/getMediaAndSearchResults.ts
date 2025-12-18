import { getJsonValue, setJsonValue } from "./redis.ts";
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
const PROWLARR_SEARCH_CACHE_TTL = 86400; // 1 day

/**
 * Optimized fetcher with Parallel Cache Lookups and Single-Pass Mapping
 */
export async function getMediaAndSearchResults(
    type: 'movie' | 'series',
    episodeInfo: RequestedEpisode
): Promise<{ cinemetaData: CinemetaData; results: SearchResult[] }> {

    const { imdbid: imdbId, season, episode } = episodeInfo;
    if (!imdbId) throw new Error("IMDB ID is required");

    // 1. Generate Cache Keys immediately
    const cinemetaKey = `cinemeta:${type}:${imdbId}`;
    const searchKey = (season && episode)
        ? `search:${imdbId}:${season}:${episode}`
        : `search:${imdbId}`;

    // 2. Parallel Cache Lookup (IO Optimization)
    // We don't need Cinemeta data to CHECK the search cache, only to PERFORM a search.
    const [cachedMeta, cachedResults] = await Promise.all([
        getJsonValue<CinemetaData>(cinemetaKey),
        getJsonValue<SearchResult[]>(searchKey)
    ]);

    // 3. Resolve Metadata
    // If we have it in cache, use it. If not, start the fetch.
    let cinemetaPromise: Promise<CinemetaData> | CinemetaData;

    if (cachedMeta) {
        cinemetaPromise = cachedMeta;
    } else {
        console.log(`[Cache] Cinemeta miss for ${cinemetaKey}`);
        // We wrap this in a promise to await it only if needed later
        cinemetaPromise = getCinemetaData(type, imdbId).then(async (data) => {
            // Background cache set (don't await this if not critical)
            setJsonValue(cinemetaKey, '$', data, CINEMETA_CACHE_TTL).catch(console.error);
            return data as CinemetaData;
        });
    }

    // 4. Resolve Search Results
    let results: SearchResult[] = [];

    if (cachedResults) {
        results = cachedResults;
        // If we have search results, we just need to ensure metadata is resolved for the return value
        // We await it here to keep the return type signature clean
        const cinemetaData = await cinemetaPromise;
        return { cinemetaData, results };
    }

    // --- Search Cache Miss: Perform Live Search ---

    console.log(`[Cache] Search miss for ${searchKey}`);

    // We MUST have metadata now to search (for TVDB/Year)
    const cinemetaData = await cinemetaPromise;

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

    // Provider Logic: Single Pass Mapping
    if (Config.NZBHYDRA_URL && Config.NZBHYDRA_API_KEY) {
        console.log(`[Search] Using Provider: NZBHydra2`);
        const hydraResults = await searchHydra(searchOptions);
        results = hydraResults.map(h => ({
            guid: h.guid,
            title: h.title,
            downloadUrl: h.downloadUrl,
            size: h.size,
            indexer: h.indexer,
            age: h.age,
            protocol: "usenet",
            fileName: h.title // Normalize
        }));

    } else if (Config.PROWLARR_URL && Config.PROWLARR_API_KEY) {
        console.log(`[Search] Using Provider: Prowlarr`);
        const prowlarrResults = await searchProwlarr(searchOptions);
        // Prowlarr lib likely returns the correct shape, but we cast to ensure
        results = prowlarrResults as SearchResult[];

    } else {
        console.log(`[Search] Using Provider: Direct/SQLite`);
        const directResults = await searchDirect(searchOptions);
        results = directResults.map(r => ({
            guid: r.guid,
            title: r.title,
            downloadUrl: r.downloadUrl,
            size: r.size,
            indexer: r.indexer,
            age: r.age,
            protocol: "usenet",
            fileName: r.title
        }));

        if (results.length === 0) {
            console.warn(`[Search] No results found via Direct search.`);
        }
    }

    // Cache the results
    // We don't await this to return the response faster to the UI/API
    setJsonValue(searchKey, '$', results, PROWLARR_SEARCH_CACHE_TTL).catch(console.error);

    return { cinemetaData, results };
}