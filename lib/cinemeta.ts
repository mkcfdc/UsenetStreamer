import { Config } from "../env.ts";
import { fetcher } from "../utils/fetcher.ts";

interface CinemetaResponse {
    meta: {
        name: string;
        year?: number | string;
        id: string;
        imdb_id?: string;
        tvdb_id?: string | number;
        tmdb_id?: string | number;
        ids?: {
            tvdb?: string | number;
            tmdb?: string | number;
        };
        externals?: {
            tvdb?: string | number;
            tmdb?: string | number;
        };
    };
}

export interface CinemetaData {
    name: string;
    year: string;
    imdbId: string;
    tvdbId?: string;
    tmdbId?: string;
}

/**
 * Fetch movie or series data from Cinemeta
 * @param type "movie" | "series"
 * @param imdbId Optional IMDb ID to fetch a single item
 */
export async function getCinemetaData(
    type: "movie" | "series",
    imdbId?: string
): Promise<CinemetaData> {

    const url = `${Config.CINEMETA_URL}/${type}/${imdbId}.json`;

    try {
        const data = await fetcher<CinemetaResponse>(url);
        if (!data.meta?.name || !data.meta.id) {
            throw new Error("Cinemeta response is missing required metadata");
        }
        const meta = data.meta;
        return {
            name: meta.name,
            year: meta.year === undefined ? "" : String(meta.year),
            imdbId: meta.imdb_id || meta.id,
            tvdbId: toOptionalString(meta.ids?.tvdb || meta.tvdb_id || meta.externals?.tvdb),
            tmdbId: toOptionalString(meta.ids?.tmdb || meta.tmdb_id || meta.externals?.tmdb),
        };
    } catch (err) {
        console.error(`[CINEMETA] Error fetching ${type} ${imdbId || ""}:`, err);
        throw err;
    }
}

function toOptionalString(value: string | number | undefined): string | undefined {
    return value === undefined ? undefined : String(value);
}