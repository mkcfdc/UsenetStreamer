import { PROWLARR_API_KEY, PROWLARR_URL } from "../env.ts";
import { fetcher } from "../utils/fetcher.ts";

interface ProwlarrSearchOptions {
    imdbId?: string;
    tvdbId?: string;
    tmdbId?: string;
    name?: string;
    year?: string;
    limit?: number;
    type?: 'movie' | 'series';
    season?: number;
    episode?: number;
}

interface SearchPlan {
    type: 'search' | 'movie' | 'tvsearch';
    query: string;
}

interface ProwlarrResult {
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

// --- Helpers ---

const isUsenetProtocol = (result: ProwlarrResult): boolean => {
    if (result.protocol?.toLowerCase() !== "usenet") return false;

    // Double check against magnet/torrent artifacts just in case
    const guid = (result.guid || "").toLowerCase();
    const downloadUrl = (result.downloadUrl || "").toLowerCase();
    if (guid.startsWith("magnet:") || downloadUrl.startsWith("magnet:") ||
        guid.endsWith(".torrent") || downloadUrl.endsWith(".torrent")) {
        return false;
    }
    return true;
};

const normalizeTitle = (title: string): string => {
    return title
        .toLowerCase()
        .replace(/[\[\](){}]/g, '') // Remove brackets
        .replace(/[^a-z0-9]+/g, ' ') // Non-alphanumeric to space
        .replace(/\b(repack|proper|internal|multi|dual|hdr|dv|atmos|subs|webrip|webdl|web-dl|bluray|uhd|remux|hevc|h265|x265|x264|avc|h264|10bit|2160p|1080p|720p|480p|576p|hdr10|dolby|vision)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
};

const fileMatchesEpisode = (fileName: string, season: number, episode: number): boolean => {
    // We construct a single Regex with "OR" operators (|)
    // 1. s0*S\.?e0*E   -> Matches S01E01, S1E1, S01.E01 (Handles the dot automatically)
    // 2. 0*Sx0*E       -> Matches 1x01, 01x01
    // 3. ep...         -> Matches Ep 01, Episode 01

    const regex = new RegExp(
        `(?:s0*${season}\\.?e0*${episode}|0*${season}x0*${episode}|(?:episode|ep)\\.?\\s*0*${episode})(?![0-9])`,
        "i"
    );

    return regex.test(fileName);
};

const titleContainsName = (title: string, name: string): boolean => {
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalizedTitle.includes(normalizedName);
};

// --- Main Logic ---

export async function searchProwlarr(opts: ProwlarrSearchOptions): Promise<ProwlarrResult[]> {
    // 1. Build Search Plans
    const plans = new Map<string, SearchPlan>();
    const defaultType = opts.type === "series" ? "tvsearch" : opts.type === "movie" ? "movie" : "search";

    const addPlan = (type: SearchPlan['type'], query: string) => {
        if (query && !plans.has(`${type}|${query}`)) {
            plans.set(`${type}|${query}`, { type, query });
        }
    };

    // ID-based plans
    if (opts.imdbId) addPlan(defaultType, `{ImdbId:${opts.imdbId}}`);
    if (opts.type === "series" && opts.tvdbId) addPlan("tvsearch", `{TvdbId:${opts.tvdbId}}`);
    if (opts.type === "movie" && opts.tmdbId) addPlan("movie", `{TmdbId:${opts.tmdbId}}`);

    // Text fallback
    const textParts: string[] = [];
    if (opts.name) textParts.push(opts.name);
    if (opts.type === "movie" && opts.year) {
        textParts.push(`(${opts.year})`);
    } else if (opts.type === "series" && opts.season && opts.episode) {
        textParts.push(`S${String(opts.season).padStart(2, "0")}E${String(opts.episode).padStart(2, "0")}`);
    }

    const textQuery = textParts.join(" ").trim();
    if (textQuery) addPlan("search", textQuery);

    // Fallback: if no specific ID plans exist but we have IMDB, ensure it's added
    if (plans.size === 0 && opts.imdbId) addPlan(defaultType, `{ImdbId:${opts.imdbId}}`);

    // 2. Prepare Execution Params
    const categoryId = (opts.type === "series" || (opts.season && opts.episode)) ? "5000" : "2000";
    const limit = String(opts.limit ?? 25);

    const uniquePlans = Array.from(plans.values());

    // 3. Execute Searches in Parallel
    const searchPromises = uniquePlans.map(async (plan) => {
        const params = new URLSearchParams({
            apikey: PROWLARR_API_KEY!,
            limit,
            offset: "0",
            indexerIds: "-1",
            type: plan.type,
            query: plan.query,
            protocol: "usenet", // We only want Usenet
            categories: categoryId,
            ...(opts.season && { season: String(opts.season) }),
            ...(opts.episode && { ep: String(opts.episode) }),
        });

        const url = `${PROWLARR_URL}/api/v1/search?${params.toString()}`;
        console.log(`[Prowlarr] Fetching: ${plan.type} -> ${plan.query}`);

        try {
            const data = await fetcher<ProwlarrResult[]>(url);
            return Array.isArray(data) ? data : [];
        } catch (error: any) {
            console.error(`[Prowlarr] Plan failed (${plan.query}):`, error.message);
            return [];
        }
    });

    const rawResultsGrouped = await Promise.all(searchPromises);
    const flatResults = rawResultsGrouped.flat();

    // 4. Filter & Deduplicate
    const bestResults = new Map<string, ProwlarrResult>();

    for (const result of flatResults) {
        // Basic Integrity Check
        if (!result || !result.downloadUrl || !result.title) continue;

        // Protocol Check
        if (!isUsenetProtocol(result)) continue;

        // Strict Series Matching
        if (opts.season && opts.episode) {
            if (!fileMatchesEpisode(result.title, opts.season, opts.episode)) {
                console.debug(`[Prowlarr] Skipped (S${opts.season}E${opts.episode} mismatch): ${result.title}`);
                continue;
            }
        }

        // Strict Name Matching
        if (opts.name && !titleContainsName(result.title, opts.name)) {
            console.debug(`[Prowlarr] Skipped (Name mismatch): ${result.title}`);
            continue;
        }

        // Deduplication: Keep largest file for same normalized title
        const key = normalizeTitle(result.title);
        const existing = bestResults.get(key);

        if (!existing || result.size > existing.size) {
            bestResults.set(key, result);
        }
    }

    const finalResults = Array.from(bestResults.values());

    // 5. Sort (GUID presence preference)
    finalResults.sort((a, b) => {
        if (a.guid && !b.guid) return -1;
        if (!a.guid && b.guid) return 1;
        return 0; // Keep existing order otherwise
    });

    console.log(`[Prowlarr] Found ${finalResults.length} unique results.`);
    return finalResults;
}
