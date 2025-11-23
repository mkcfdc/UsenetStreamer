// search.ts
import { getEnabledIndexers, type Indexer } from "../utils/sqlite.ts";

// --- Types ---

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

// Loose interface for the raw API response
// Indexers auto-converting XML to JSON often produce nested structures
interface RawNewznabItem {
    title: string;
    guid: string | { text: string };
    link: string;
    pubDate: string;
    enclosure?: {
        "@attributes"?: { length: string };
        length?: string;
    };
    size?: number | string; // Some custom implementations
    attr?: Array<{ "@attributes": { name: string; value: string } }>;
}

interface RawNewznabResponse {
    channel?: {
        item?: RawNewznabItem[] | RawNewznabItem;
    };
}

// --- Helpers ---

const normalizeTitle = (title: string): string => {
    return title
        .toLowerCase()
        .replace(/[\[\](){}]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(repack|proper|internal|multi|dual|hdr|dv|atmos|subs|webrip|webdl|web-dl|bluray|uhd|remux|hevc|h265|x265|x264|avc|h264|10bit|2160p|1080p|720p|480p|576p|hdr10|dolby|vision)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
};

const fileMatchesEpisode = (fileName: string, season: number, episode: number): boolean => {
    const regex = new RegExp(`(?:s0*${season}\\.?e0*${episode}|0*${season}x0*${episode})(?![0-9])`, "i");
    return regex.test(fileName);
};

const titleContainsName = (title: string, name: string): boolean => {
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");
    return normalizedTitle.includes(normalizedName);
};

// Helper to find size in messy JSON structures
const parseSize = (item: RawNewznabItem): number => {
    // 1. Check standard enclosure attribute
    if (item.enclosure?.["@attributes"]?.length) {
        return parseInt(item.enclosure["@attributes"].length, 10);
    }
    // 2. Check direct length on enclosure
    if (item.enclosure?.length) {
        return parseInt(item.enclosure.length, 10);
    }
    // 3. Check explicit size property (some indexers)
    if (item.size) {
        return Number(item.size);
    }
    return 0;
};

// --- Main Logic ---

export async function searchDirect(opts: SearchOptions): Promise<NzbResult[]> {
    const indexers = getEnabledIndexers();
    if (indexers.length === 0) {
        console.warn("No indexers found in DB");
        return [];
    }

    // 1. Construct Query Parameters
    const queryParams: Record<string, string> = {
        limit: String(opts.limit ?? 25),
        extended: "1",
        o: "json", // Force JSON
    };

    // Category logic (standard Newznab codes)
    // 2000=Movies, 5000=TV
    if (opts.type === "series") queryParams["cat"] = "5000,5030,5040";
    else if (opts.type === "movie") queryParams["cat"] = "2000,2030,2040";

    // Determine Search Mode (t parameter)
    let mode = "search";
    if (opts.type === "movie" && opts.imdbId) {
        mode = "movie";
        queryParams["imdbid"] = opts.imdbId.replace("tt", "");
    } else if (opts.type === "series" && opts.tvdbId) {
        mode = "tvsearch";
        queryParams["tvdbid"] = opts.tvdbId;
        if (opts.season) queryParams["season"] = String(opts.season);
        if (opts.episode) queryParams["ep"] = String(opts.episode);
    } else if (opts.name) {
        // Text Fallback
        mode = opts.type === "series" ? "tvsearch" : opts.type === "movie" ? "movie" : "search";

        const parts = [opts.name];
        if (opts.type === "movie" && opts.year) parts.push(opts.year);
        else if (opts.season && opts.episode) parts.push(`S${String(opts.season).padStart(2, "0")}E${String(opts.episode).padStart(2, "0")}`);

        queryParams["q"] = parts.join(" ");
    }

    queryParams["t"] = mode;

    // 2. Execute Parallel Fetches
    const fetchPromises = indexers.map(async (indexer) => {
        const params = new URLSearchParams({
            apikey: indexer.api_key,
            ...queryParams
        });

        const url = `${indexer.url}/api?${params.toString()}`;
        const logLabel = `[${indexer.name}]`;

        try {
            // console.log(`${logLabel} Requesting: ${url}`); // Debug
            const res = await fetch(url);

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            // We expect JSON now
            const data = await res.json() as RawNewznabResponse;

            if (!data.channel?.item) return [];

            // Handle "item" being either an Object or an Array
            const rawItems = Array.isArray(data.channel.item)
                ? data.channel.item
                : [data.channel.item];

            return rawItems.map((item): NzbResult => {
                const pubDateMs = new Date(item.pubDate).getTime();
                const ageDays = Math.floor((Date.now() - pubDateMs) / (1000 * 60 * 60 * 24));

                // Extract GUID (sometimes string, sometimes object with text)
                const guid = typeof item.guid === 'object' && item.guid !== null
                    ? (item.guid as any).text || (item.guid as any)["#text"]
                    : item.guid;

                return {
                    indexer: indexer.name,
                    title: item.title,
                    guid: String(guid),
                    downloadUrl: item.link,
                    size: parseSize(item),
                    publishDate: new Date(pubDateMs).toISOString(),
                    age: ageDays > 0 ? ageDays : 0,
                };
            });

        } catch (err: any) {
            console.error(`${logLabel} Failed: ${err.message}`);
            return [];
        }
    });

    const groupedResults = await Promise.all(fetchPromises);
    const flatResults = groupedResults.flat();

    // 3. Deduplicate & Filter (Logic preserved)
    const bestResults = new Map<string, NzbResult>();

    for (const result of flatResults) {
        if (!result.downloadUrl || !result.title) continue;

        if (opts.season && opts.episode && !fileMatchesEpisode(result.title, opts.season, opts.episode)) {
            continue;
        }

        if (opts.name && !titleContainsName(result.title, opts.name)) {
            continue;
        }

        const key = normalizeTitle(result.title);
        const existing = bestResults.get(key);

        // Keep if new, or if larger size (better quality heuristic)
        if (!existing || result.size > existing.size) {
            bestResults.set(key, result);
        }
    }

    const finalResults = Array.from(bestResults.values());
    finalResults.sort((a, b) => b.size - a.size);

    console.log(`[Aggregator] Found ${finalResults.length} unique results.`);
    return finalResults;
}
