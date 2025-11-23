import { NZBHYDRA_API_KEY, NZBHYDRA_URL } from "../env.ts";
import { fetcher } from "../utils/fetcher.ts";

// --- Types based on your JSON snippet ---

interface HydraSearchOptions {
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

interface HydraResult {
    guid: string | null;
    title: string;
    size: number;
    age: number; // Days
    indexer: string;
    downloadUrl: string;
    publishDate: string;
    protocol: 'usenet';
}

// JSON Response Structure
interface HydraAttr {
    "@attributes": {
        name: string;
        value: string;
    };
}

interface HydraItem {
    title: string;
    guid: string;
    link: string;
    comments: string;
    pubDate: number; // Unix timestamp in seconds based on your sample
    category: string;
    description: string;
    enclosure?: {
        "@attributes": {
            url: string;
            length: string; // size in bytes
            type: string;
        };
    };
    attr: HydraAttr[];
}

interface HydraResponse {
    channel?: {
        item?: HydraItem[] | HydraItem; // Can be single object or array
        response?: {
            "@attributes": {
                total: string;
                offset: string;
            }
        }
    };
}

interface HydraUrlBuilder {
    t: 'search' | 'tvsearch' | 'movie';
    q?: string;
    imdbid?: string;
    tvdbid?: string;
    rid?: string;
    season?: string;
    ep?: string;
}

// --- Helpers ---

const normalizeTitle = (title: string): string => {
    return title
        .toLowerCase()
        .replace(/[\[\](){}]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(repack|proper|internal|multi|dual|hdr|dv|atmos|subs|webrip|webdl|web-dl|bluray|uhd|remux|hevc|h265|x265|x264|avc|h264|10bit|2160p|1080p|720p|480p|576p|hdr10|dolby|vision)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
};

const fileMatchesEpisode = (fileName: string, season: number, episode: number): boolean => {
    // Combine valid patterns into a single Regex.
    // 1. Matches "S01E01", "s1e1", "S01.E01" (Pattern 1 & 2 merged)
    // 2. Matches "1x01", "01x01" (Pattern 3)
    // Note: Removed the "Episode XX" pattern because it ignored the season 
    // (causing S02E01 to match a search for S01E01).
    const regex = new RegExp(`(?:s0*${season}\\.?e0*${episode}|0*${season}x0*${episode})(?![0-9])`, "i");

    return regex.test(fileName);
};

const titleContainsName = (title: string, name: string): boolean => {
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalizedTitle.includes(normalizedName);
};

export async function searchHydra(opts: HydraSearchOptions): Promise<HydraResult[]> {
    // 1. Build Search Plans
    const plans: HydraUrlBuilder[] = [];

    // ID Based Searches
    if (opts.type === "movie" && opts.imdbId) {
        plans.push({ t: 'movie', imdbid: opts.imdbId.replace('tt', '') });
    } else if (opts.type === "series" && opts.tvdbId) {
        const tvParams: HydraUrlBuilder = { t: 'tvsearch', tvdbid: opts.tvdbId };
        if (opts.season) tvParams.season = String(opts.season);
        if (opts.episode) tvParams.ep = String(opts.episode);
        plans.push(tvParams);
    }

    // Text Fallback construction
    const textParts: string[] = [];
    if (opts.name) textParts.push(opts.name);

    if (opts.type === "movie" && opts.year && !opts.imdbId) {
        textParts.push(opts.year);
    } else if (opts.type === "series" && opts.season && opts.episode && !opts.tvdbId) {
        textParts.push(`S${String(opts.season).padStart(2, "0")}E${String(opts.episode).padStart(2, "0")}`);
    }

    const textQuery = textParts.join(" ").trim();

    // If text query exists and we have no ID plans (or you want to try both), add text plan
    if (textQuery && plans.length === 0) {
        const type = opts.type === 'series' ? 'tvsearch' : opts.type === 'movie' ? 'movie' : 'search';
        plans.push({ t: type, q: textQuery });
    }

    // 2. Prepare Execution
    const categoryId = (opts.type === "series" || (opts.season && opts.episode)) ? "5000" : "2000";
    const limit = String(opts.limit ?? 25);

    // 3. Execute Searches
    const searchPromises = plans.map(async (plan) => {
        const params = new URLSearchParams({
            apikey: NZBHYDRA_API_KEY!,
            limit,
            offset: "0",
            cat: categoryId,
            o: "json", // Request JSON output
            ...plan
        });

        const url = `${NZBHYDRA_URL}/api?${params.toString()}`;
        const logName = plan.imdbid ? `IMDB:${plan.imdbid}` : plan.tvdbid ? `TVDB:${plan.tvdbid}` : plan.q;

        console.log(`[Hydra] Fetching: ${plan.t} -> ${logName}`);

        try {
            // Use generic fetcher assuming it parses JSON automatically
            const data = await fetcher<HydraResponse>(url);

            if (!data.channel || !data.channel.item) return [];

            // Handle Case: Single result (Obj) vs Multiple results (Array)
            const items = Array.isArray(data.channel.item)
                ? data.channel.item
                : [data.channel.item];

            return items.map((item): HydraResult | null => {
                // Extract Indexer Name from attributes
                const indexerAttr = item.attr.find(a => a["@attributes"].name === "hydraIndexerName");
                const indexerName = indexerAttr ? indexerAttr["@attributes"].value : "NZBHydra2";

                // Parse Size
                const sizeStr = item.enclosure?.["@attributes"]?.length || "0";
                const size = parseInt(sizeStr, 10);

                // Calculate Age
                // pubDate in your JSON is seconds (float), e.g. 1763125256.0
                const pubDateMs = item.pubDate * 1000;
                const ageDays = Math.floor((Date.now() - pubDateMs) / (1000 * 60 * 60 * 24));

                return {
                    title: item.title,
                    guid: item.guid,
                    downloadUrl: item.link,
                    size,
                    publishDate: new Date(pubDateMs).toISOString(),
                    age: ageDays > 0 ? ageDays : 0,
                    indexer: indexerName,
                    protocol: 'usenet'
                };
            }).filter((x): x is HydraResult => x !== null);

        } catch (error: any) {
            console.error(`[Hydra] Plan failed (${logName}):`, error.message);
            return [];
        }
    });

    const rawResultsGrouped = await Promise.all(searchPromises);
    const flatResults = rawResultsGrouped.flat();

    // 4. Filter & Deduplicate
    const bestResults = new Map<string, HydraResult>();

    for (const result of flatResults) {
        if (!result.downloadUrl || !result.title) continue;

        // Strict Series Matching
        if (opts.season && opts.episode) {
            if (!fileMatchesEpisode(result.title, opts.season, opts.episode)) {
                continue;
            }
        }

        // Strict Name Matching
        if (opts.name && !titleContainsName(result.title, opts.name)) {
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

    // 5. Sort by Size (Best quality first usually)
    finalResults.sort((a, b) => b.size - a.size);

    console.log(`[Hydra] Found ${finalResults.length} unique results.`);
    return finalResults;
}
