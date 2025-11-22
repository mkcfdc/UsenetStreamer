import { getJsonValue, setJsonValue } from "./redis.ts";
import { getCinemetaData } from "../lib/cinemeta.ts";
import { searchHydra } from "../lib/nzbhydra.ts";
import { searchProwlarr } from "../lib/prowlarr.ts";
import {
    NZBHYDRA_URL,
    NZBHYDRA_API_KEY,
    PROWLARR_URL,
    PROWLARR_API_KEY
} from "../env.ts";

interface RequestedEpisode {
    imdbid?: string;
    season?: number | undefined;
    episode?: number | undefined;
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
 * Fetches media metadata and search results, utilizing Redis for caching both API calls.
 */
export async function getMediaAndSearchResults(
    type: 'movie' | 'series',
    episodeInfo: RequestedEpisode
): Promise<{ cinemetaData: CinemetaData; results: SearchResult[] }> {

    const { imdbid: imdbId, season, episode } = episodeInfo;

    const cinemetaKey = `cinemeta:${type}:${imdbId}`;
    let cinemetaData: CinemetaData | null = await getJsonValue<CinemetaData>(cinemetaKey);

    if (!cinemetaData) {
        console.log(`[Cache] Cinemeta miss for ${cinemetaKey}`);
        const fetchedData = await getCinemetaData(type, imdbId);
        cinemetaData = fetchedData as CinemetaData;

        await setJsonValue(cinemetaKey, '$', cinemetaData, CINEMETA_CACHE_TTL);
    }

    const { name: showName, year, tvdbId, tmdbId } = cinemetaData!;

    // --- 2. Check Search Cache ---
    const searchKey = episode && season
        ? `search:${imdbId}:${season}:${episode}`
        : `search:${imdbId}`;

    let results: SearchResult[] | null = await getJsonValue<SearchResult[]>(searchKey);

    if (!results) {
        console.log(`[Cache] Search miss for ${searchKey} (Provider lookup needed)`);

        const searchOptions = {
            imdbId,
            tvdbId,
            tmdbId,
            name: showName,
            year: String(year),
            type,
            limit: 50,
            season,
            episode,
        };

        let rawResults: SearchResult[] = [];

        if (NZBHYDRA_URL && NZBHYDRA_API_KEY) {
            console.log(`[Search] Using Provider: NZBHydra2`);
            const hydraResults = await searchHydra(searchOptions);

            rawResults = hydraResults.map(h => ({
                guid: h.guid,
                title: h.title,
                downloadUrl: h.downloadUrl,
                size: h.size,
                indexer: h.indexer,
                age: h.age,
                protocol: "usenet",
                fileName: h.title
            }));

            // PRIORITY 2: Prowlarr
        } else if (PROWLARR_URL && PROWLARR_API_KEY) {
            console.log(`[Search] Using Provider: Prowlarr`);
            const prowlarrResults = await searchProwlarr(searchOptions);

            rawResults = prowlarrResults as SearchResult[];

        } else {
            console.warn(`[Search] No search provider configured (Hydra or Prowlarr)`);
            rawResults = [];
        }

        results = rawResults.map(r => ({
            guid: r.guid,
            title: r.title,
            downloadUrl: r.downloadUrl,
            size: r.size,
            indexer: r.indexer,
            age: r.age,
            protocol: r.protocol || 'usenet'
        }));

        await setJsonValue(
            searchKey,
            '$',
            results,
            PROWLARR_SEARCH_CACHE_TTL
        );
    }

    return { cinemetaData: cinemetaData!, results: results! };
}
