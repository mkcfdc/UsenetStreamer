import { getEnabledIndexers, type Indexer } from "../utils/sqlite.ts";

export interface SearchOptions {
    imdbId?: string;
    tvdbId?: string;
    name?: string;
    year?: string;
    limit?: number;
    type?: "movie" | "series";
    season?: number;
    episode?: number;
}

export interface NzbResult {
    guid: string;
    title: string;
    size: number;
    age: number;
    indexer: string;
    downloadUrl: string;
    publishDate: string;
}

interface RawNewznabItem {
    title: string;
    guid: string | { text?: string; "#text"?: string };
    link: string;
    pubDate: string;
    enclosure?: {
        "@attributes"?: { length?: string };
        length?: string | number;
    };
    size?: number | string;
}

interface RawNewznabResponse {
    channel?: {
        item?: RawNewznabItem[] | RawNewznabItem;
    };
}

const MS_PER_DAY = 86400000; // 1000 * 60 * 60 * 24
const MOVIE_CATEGORIES = "2000,2030,2040,6010,6030,6040";
const TV_CATEGORIES = "5000,5030,5040";

// Pre-compiled regex for performance
const NORMALIZE_BRACKETS = /[\[\](){}]/g;
const NORMALIZE_NON_ALNUM = /[^a-z0-9]+/g;
const NORMALIZE_KEYWORDS = /\b(repack|proper|internal|multi|dual|hdr|dv|atmos|subs|webrip|webdl|web-dl|bluray|uhd|remux|hevc|h265|x265|x264|avc|h264|10bit|2160p|1080p|720p|480p|576p|hdr10|dolby|vision)\b/g;
const NORMALIZE_SPACES = /\s+/g;
const STRIP_NON_ALNUM = /[^a-z0-9]/g;

const episodePatternCache = new Map<string, RegExp>();

// --- Helpers ---

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
            `(?:s0*${season}\\.?e0*${episode}|0*${season}x0*${episode})(?![0-9])`,
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

function parseSize(item: RawNewznabItem): number {
    // Check paths in order of likelihood
    const enclosure = item.enclosure;
    if (enclosure) {
        const attrs = enclosure["@attributes"];
        if (attrs?.length) return parseInt(attrs.length, 10) || 0;
        if (enclosure.length) return parseInt(String(enclosure.length), 10) || 0;
    }
    if (item.size) return Number(item.size) || 0;
    return 0;
}

function extractGuid(guid: RawNewznabItem["guid"]): string {
    if (typeof guid === "string") return guid;
    if (guid && typeof guid === "object") {
        return guid.text ?? guid["#text"] ?? "";
    }
    return "";
}

function parseItem(item: RawNewznabItem, indexerName: string, now: number): NzbResult {
    const pubDateMs = new Date(item.pubDate).getTime();
    const ageDays = Math.max(0, ((now - pubDateMs) / MS_PER_DAY) | 0);

    return {
        indexer: indexerName,
        title: item.title,
        guid: extractGuid(item.guid),
        downloadUrl: item.link,
        size: parseSize(item),
        publishDate: new Date(pubDateMs).toISOString(),
        age: ageDays,
    };
}

// --- Fetch Logic ---

async function fetchIndexer(
    indexer: Indexer,
    params: URLSearchParams,
    now: number,
): Promise<NzbResult[]> {
    const url = `${indexer.url}/api?${params}`;

    try {
        const res = await fetch(url, {
            headers: { "Accept": "application/json" },
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
            console.error(`[${indexer.name}] HTTP ${res.status}`);
            return [];
        }

        const data = await res.json() as RawNewznabResponse;
        const items = data.channel?.item;

        if (!items) return [];

        // Handle single item vs array
        const rawItems = Array.isArray(items) ? items : [items];

        // Pre-allocate result array
        const results = new Array<NzbResult>(rawItems.length);
        for (let i = 0; i < rawItems.length; i++) {
            results[i] = parseItem(rawItems[i], indexer.name, now);
        }

        return results;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${indexer.name}] ${msg}`);
        return [];
    }
}

// --- Main Export ---

export async function searchDirect(opts: SearchOptions): Promise<NzbResult[]> {
    const indexers = getEnabledIndexers();

    if (indexers.length === 0) {
        console.warn("[Search] No indexers configured");
        return [];
    }

    // Build base query params once
    const baseParams: Record<string, string> = {
        limit: String(opts.limit ?? 25),
        extended: "1",
        o: "json",
    };

    // Categories
    if (opts.type === "series") {
        baseParams.cat = TV_CATEGORIES;
    } else if (opts.type === "movie") {
        baseParams.cat = MOVIE_CATEGORIES;
    }

    // Search mode & identifiers
    let mode: string;

    if (opts.type === "movie" && opts.imdbId) {
        mode = "movie";
        baseParams.imdbid = opts.imdbId.replace("tt", "");
    } else if (opts.type === "series" && opts.tvdbId) {
        mode = "tvsearch";
        baseParams.tvdbid = opts.tvdbId;
        if (opts.season) baseParams.season = String(opts.season);
        if (opts.episode) baseParams.ep = String(opts.episode);
    } else if (opts.name) {
        mode = opts.type === "series" ? "tvsearch"
            : opts.type === "movie" ? "movie"
                : "search";

        let query = opts.name;
        if (opts.type === "movie" && opts.year) {
            query += ` ${opts.year}`;
        } else if (opts.season && opts.episode) {
            query += ` S${String(opts.season).padStart(2, "0")}E${String(opts.episode).padStart(2, "0")}`;
        }
        baseParams.q = query;
    } else {
        mode = "search";
    }

    baseParams.t = mode;

    // Capture timestamp once for consistent age calculation
    const now = Date.now();

    // Build per-indexer params (only apikey differs)
    const fetchPromises = indexers.map((indexer) => {
        const params = new URLSearchParams(baseParams);
        params.set("apikey", indexer.api_key);
        return fetchIndexer(indexer, params, now);
    });

    // Parallel fetch all indexers
    const groupedResults = await Promise.all(fetchPromises);

    // Flatten with size hint for better allocation
    const totalHint = groupedResults.reduce((sum, arr) => sum + arr.length, 0);
    const flatResults: NzbResult[] = [];
    flatResults.length = totalHint;

    let idx = 0;
    for (const group of groupedResults) {
        for (const result of group) {
            flatResults[idx++] = result;
        }
    }
    flatResults.length = idx; // Trim if overallocated

    // Skip filtering if no results
    if (flatResults.length === 0) {
        console.log("[Search] No results found");
        return [];
    }

    // Deduplicate & filter
    const bestResults = new Map<string, NzbResult>();
    const needsEpisodeCheck = opts.season !== undefined && opts.episode !== undefined;
    const needsNameCheck = opts.name !== undefined;

    for (let i = 0; i < flatResults.length; i++) {
        const result = flatResults[i];

        // Skip invalid entries
        if (!result.downloadUrl || !result.title) continue;

        // Episode filter
        if (needsEpisodeCheck && !fileMatchesEpisode(result.title, opts.season!, opts.episode!)) {
            continue;
        }

        // Name filter
        if (needsNameCheck && !titleContainsName(result.title, opts.name!)) {
            continue;
        }

        // Dedupe by normalized title, keep largest
        const key = normalizeTitle(result.title);
        const existing = bestResults.get(key);

        if (!existing || result.size > existing.size) {
            bestResults.set(key, result);
        }
    }

    // Convert to array and sort by size descending
    const finalResults = Array.from(bestResults.values());
    finalResults.sort((a, b) => b.size - a.size);

    console.log(`[Search] ${finalResults.length} unique results from ${indexers.length} indexers`);
    return finalResults;
}

/**
 * Search with timeout wrapper - useful for UI with loading states
 */
export async function searchDirectWithTimeout(
    opts: SearchOptions,
    timeoutMs = 20000,
): Promise<NzbResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await searchDirect(opts);
    } finally {
        clearTimeout(timeout);
    }
}
