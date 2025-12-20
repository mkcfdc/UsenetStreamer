import { Config } from "../env.ts";

// Pre-compile Regex for performance
export const REGEX_GUID_PARAM = /[?&]guid=([^&]+)/;
export const REGEX_LAST_SEGMENT = /\/([^\/?#]+)$/;
export const REGEX_JSON_EXT = /\.json$/;

// Resolution Lookup Maps (Order matters: checked top-down in loop)
export const RES_RANK_MAP: Record<string, number> = {
    "4k": 4,
    "2160": 4,
    "uhd": 4,
    "2k": 3,
    "1440": 3,
    "1080": 2,
    "fhd": 2,
    "720": 1,
    "hd": 1,
};

export const RES_ICON_MAP: Record<string, string> = {
    "4k": "🔥 4K UHD",
    "2160": "🔥 4K UHD",
    "uhd": "🔥 4K UHD",
    "2k": "🔥 2K",
    "1440": "🔥 2K",
    "1080": "🚀 FHD",
    "fhd": "🚀 FHD",
    "720": "💿 HD",
    "hd": "💿 HD",
};

/**
 * Parse Redis JSON response handling various formats
 */
export function parseRedisJson<T>(raw: unknown): T | null {
    if (!raw) return null;
    try {
        const val = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Array.isArray(val) ? val[0] : val;
    } catch {
        return null;
    }
}

/**
 * Robust RedisJSON scalar decoder for pipelined JSON.GET results.
 * Handles:
 * - null
 * - '"/path/file.mkv"' (stringified JSON)
 * - '["/path/file.mkv"]' (JSON array)
 * - ["/path/file.mkv"] (client-decoded array)
 * - ["\"/path/file.mkv\""] (array containing stringified JSON)
 */
export function parseRedisJsonScalar(raw: unknown): string | null {
    if (raw == null) return null;

    try {
        if (Array.isArray(raw)) {
            if (raw.length === 0) return null;
            return parseRedisJsonScalar(raw[0]);
        }

        if (typeof raw === "string") {
            const s = raw.trim();
            if (!s || s === "null") return null;

            try {
                const decoded = JSON.parse(s);
                if (typeof decoded === "string" && decoded.length) return decoded;
                if (Array.isArray(decoded) && typeof decoded[0] === "string") return decoded[0];
                return null;
            } catch {
                return s;
            }
        }

        if (typeof raw === "number") return String(raw);
        return null;
    } catch {
        return null;
    }
}

/**
 * Optimized GUID extraction using Regex instead of new URL()
 */
export function extractGuidFromUrl(urlString: string): string {
    if (Config.NZBHYDRA_URL && Config.NZBHYDRA_API_KEY) return urlString;

    const queryMatch = REGEX_GUID_PARAM.exec(urlString);
    if (queryMatch) return queryMatch[1];

    const pathMatch = REGEX_LAST_SEGMENT.exec(urlString);
    if (pathMatch) return pathMatch[1];

    return urlString;
}

export function getResolutionRank(resolution: string): number {
    const r = resolution.toLowerCase();
    for (const k in RES_RANK_MAP) {
        if (r.includes(k)) return RES_RANK_MAP[k];
    }
    return 0;
}

export function getResolutionIcon(resolution: string): string {
    const r = resolution.toLowerCase();
    for (const k in RES_ICON_MAP) {
        if (r.includes(k)) return RES_ICON_MAP[k];
    }
    return "💩 Unknown";
}

export function normalizeStreamName(s: string): string {
    return s.replace(/\s+/g, " ").trim();
}
