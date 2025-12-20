import { Config } from "../env.ts";
import { fetcher } from "../utils/fetcher.ts";

// --- Types ---

export interface ProwlarrSearchOptions {
    imdbId?: string;
    tvdbId?: string;
    tmdbId?: string;
    name?: string;
    year?: string;
    limit?: number;
    type?: "movie" | "series";
    season?: number;
    episode?: number;
}

export interface ProwlarrResult {
    guid: string | null;
    title: string;
    size: number;
    age: number;
    indexer: string;
    indexerId: number;
    protocol: string;
    downloadUrl: string;
    infoUrl: string;
    posterUrl: string;
    publishDate: string;
    fileName: string;
}

interface SearchPlan {
    type: "search" | "movie" | "tvsearch";
    query: string;
}

// --- Constants ---

const PROWLARR_URL = Config.PROWLARR_URL;
const PROWLARR_API_KEY = Config.PROWLARR_API_KEY;

// Pre-compiled regex patterns
const NORMALIZE_BRACKETS = /[\[\](){}]/g;
const NORMALIZE_NON_ALNUM = /[^a-z0-9]+/g;
const NORMALIZE_KEYWORDS = /\b(repack|proper|internal|multi|dual|hdr|dv|atmos|subs|webrip|webdl|web-dl|bluray|uhd|remux|hevc|h265|x265|x264|avc|h264|10bit|2160p|1080p|720p|480p|576p|hdr10|dolby|vision)\b/g;
const NORMALIZE_SPACES = /\s+/g;
const STRIP_NON_ALNUM = /[^a-z0-9]/g;

// Episode pattern cache
const episodePatternCache = new Map<string, RegExp>();

// --- Helpers ---

function isUsenetProtocol(result: ProwlarrResult): boolean {
    if (result.protocol?.toLowerCase() !== "usenet") return false;

    const guid = result.guid?.toLowerCase() ?? "";
    const url = result.downloadUrl?.toLowerCase() ?? "";

    // Quick rejection for torrents
    return !(
        guid.startsWith("magnet:") ||
        url.startsWith("magnet:") ||
        guid.endsWith(".torrent") ||
        url.endsWith(".torrent")
    );
}

function normalizeTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(NORMALIZE_BRACKETS, "")
        .replace(NORMALIZE_NON_ALNUM, " ")
        .replace(NORMALIZE_KEYWORDS, "")
        .replace(NORMALIZE_SPACES, " ")
        .trim();
}

function getEpisodePattern(season: number, episode: number): RegExp {
    const key = `${season}:${episode}`;
    let pattern = episodePatternCache.get(key);

    if (!pattern) {
        pattern = new RegExp(
            `(?:s0*${season}\\.?e0*${episode}|0*${season}x0*${episode}|(?:episode|ep)\\.?\\s*0*${episode})(?![0-9])`,
            "i"
        );
        // Limit cache size
        if (episodePatternCache.size > 100) {
            const firstKey = episodePatternCache.keys().next().value;
            if (firstKey) episodePatternCache.delete(firstKey);
        }
        episodePatternCache.set(key, pattern);
    }

    return pattern;
}

function fileMatchesEpisode(fileName: string, season: number, episode: number): boolean {
    return getEpisodePattern(season, episode).test(fileName);
}

function titleContainsName(title: string, name: string): boolean {
    const normalizedName = name.toLowerCase().replace(STRIP_NON_ALNUM, "");
    const normalizedTitle = title.toLowerCase().replace(STRIP_NON_ALNUM, "");
    return normalizedTitle.includes(normalizedName);
}

function formatEpisode(season: number, episode: number): string {
    return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

// --- Search Execution ---

async function executeSearch(
    plan: SearchPlan,
    baseParams: Record<string, string>,
): Promise<ProwlarrResult[]> {
    const params = new URLSearchParams({
        ...baseParams,
        type: plan.type,
        query: plan.query,
    });

    const url = `${PROWLARR_URL}/api/v1/search?${params}`;

    try {
        const data = await fetcher<ProwlarrResult[]>(url, { timeoutMs: 15000 });
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error(`[Prowlarr] ${plan.type}/${plan.query}: ${err instanceof Error ? err.message : err}`);
        return [];
    }
}

// --- Main Export ---

export async function searchProwlarr(opts: ProwlarrSearchOptions): Promise<ProwlarrResult[]> {
    if (!PROWLARR_URL || !PROWLARR_API_KEY) {
        console.warn("[Prowlarr] Not configured");
        return [];
    }

    // 1. Build Search Plans
    const plans: SearchPlan[] = [];
    const planKeys = new Set<string>();

    const addPlan = (type: SearchPlan["type"], query: string): void => {
        const key = `${type}|${query}`;
        if (query && !planKeys.has(key)) {
            planKeys.add(key);
            plans.push({ type, query });
        }
    };

    const defaultType = opts.type === "series" ? "tvsearch"
        : opts.type === "movie" ? "movie"
            : "search";

    // ID-based plans (most specific)
    if (opts.imdbId) {
        addPlan(defaultType, `{ImdbId:${opts.imdbId}}`);
    }
    if (opts.type === "series" && opts.tvdbId) {
        addPlan("tvsearch", `{TvdbId:${opts.tvdbId}}`);
    }
    if (opts.type === "movie" && opts.tmdbId) {
        addPlan("movie", `{TmdbId:${opts.tmdbId}}`);
    }

    // Text fallback
    if (opts.name) {
        let textQuery = opts.name;
        if (opts.type === "movie" && opts.year) {
            textQuery += ` (${opts.year})`;
        } else if (opts.type === "series" && opts.season && opts.episode) {
            textQuery += ` ${formatEpisode(opts.season, opts.episode)}`;
        }
        addPlan("search", textQuery);
    }

    if (plans.length === 0) {
        console.warn("[Prowlarr] No search criteria provided");
        return [];
    }

    // 2. Base params (shared across all plans)
    const baseParams: Record<string, string> = {
        apikey: PROWLARR_API_KEY,
        limit: String(opts.limit ?? 25),
        offset: "0",
        indexerIds: "-1",
        protocol: "usenet",
        categories: opts.type === "series" ? "5000" : "2000",
    };

    if (opts.season) baseParams.season = String(opts.season);
    if (opts.episode) baseParams.ep = String(opts.episode);

    // 3. Execute in parallel
    const results = await Promise.all(
        plans.map(plan => executeSearch(plan, baseParams))
    );

    // 4. Flatten with pre-allocation
    const totalCount = results.reduce((sum, arr) => sum + arr.length, 0);
    if (totalCount === 0) {
        console.log("[Prowlarr] No results found");
        return [];
    }

    // 5. Filter & Deduplicate in single pass
    const bestResults = new Map<string, ProwlarrResult>();
    const needsEpisodeCheck = opts.season !== undefined && opts.episode !== undefined;
    const needsNameCheck = opts.name !== undefined;

    for (const group of results) {
        for (const result of group) {
            // Skip invalid
            if (!result?.downloadUrl || !result.title) continue;

            // Protocol check
            if (!isUsenetProtocol(result)) continue;

            // Episode check
            if (needsEpisodeCheck && !fileMatchesEpisode(result.title, opts.season!, opts.episode!)) {
                continue;
            }

            // Name check
            if (needsNameCheck && !titleContainsName(result.title, opts.name!)) {
                continue;
            }

            // Dedupe: keep largest
            const key = normalizeTitle(result.title);
            const existing = bestResults.get(key);

            if (!existing || result.size > existing.size) {
                bestResults.set(key, result);
            }
        }
    }

    // 6. Convert to array and sort
    const finalResults = Array.from(bestResults.values());

    // Sort by: has GUID first, then by size descending
    finalResults.sort((a, b) => {
        // GUID presence
        const aHasGuid = a.guid ? 1 : 0;
        const bHasGuid = b.guid ? 1 : 0;
        if (aHasGuid !== bHasGuid) return bHasGuid - aHasGuid;

        // Size (larger first)
        return b.size - a.size;
    });

    console.log(`[Prowlarr] ${finalResults.length} unique results from ${plans.length} queries`);
    return finalResults;
}
