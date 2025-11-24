import { getOrSetSetting } from "./utils/sqlite.ts";

/**
 * Configuration Manager
 * Access properties here to get the latest value from Env or DB.
 */
export const Config = {
    CINEMETA_URL: "https://v3-cinemeta.strem.io/meta",

    get ADDON_BASE_URL() {
        const val = getOrSetSetting("ADDON_BASE_URL", "", "Public URL for the addon");
        return val;
    },

    get PORT() {
        return Number(getOrSetSetting("PORT", "7000", "Port to listen on"));
    },

    get PROWLARR_URL() {
        return getOrSetSetting("PROWLARR_URL", "", "URL for Prowlarr instance");
    },

    get PROWLARR_API_KEY() {
        return getOrSetSetting("PROWLARR_API_KEY", "", "API Key for Prowlarr");
    },

    get NZBHYDRA_API_KEY() {
        return getOrSetSetting("NZBHYDRA_API_KEY", "", "API Key for NZBHydra");
    },

    get NZBHYDRA_URL() {
        return getOrSetSetting("NZBHYDRA_URL", "", "URL for NZBHydra");
    },

    get REDIS_URL() {
        const val = getOrSetSetting("REDIS_URL", "", "Connection string for Redis");
        return String(val);
    },

    get ADDON_SHARED_SECRET() {
        const val = getOrSetSetting("ADDON_SHARED_SECRET", "", "Secret for internal security");
        return val;
    },

    get OTEL_DENO() {
        return getOrSetSetting("OTEL_DENO", "false", "Enable OpenTelemetry") === "true";
    },

    // --- NZBDAV Specifics ---

    get NZBDAV_URL() {
        return getOrSetSetting("NZBDAV_URL", "", "Base URL for NZB DAV").trim();
    },

    get NZBDAV_API_KEY() {
        return getOrSetSetting("NZBDAV_API_KEY", "", "API Key for NZB DAV").trim();
    },

    get NZBDAV_CATEGORY_MOVIES() {
        return getOrSetSetting("NZBDAV_CATEGORY_MOVIES", "Movies", "Category name for Movies");
    },

    get NZBDAV_CATEGORY_SERIES() {
        return getOrSetSetting("NZBDAV_CATEGORY_SERIES", "Tv", "Category name for TV Series");
    },

    get NZBDAV_CATEGORY_DEFAULT() {
        return getOrSetSetting("NZBDAV_CATEGORY_DEFAULT", "Movies", "Default download category");
    },

    get NZBDAV_WEBDAV_USER() {
        return getOrSetSetting("NZBDAV_WEBDAV_USER", "", "WebDAV Username").trim();
    },

    get NZBDAV_WEBDAV_PASS() {
        return getOrSetSetting("NZBDAV_WEBDAV_PASS", "", "WebDAV Password").trim();
    },

    get NZBDAV_WEBDAV_URL() {
        // Logic: Use specific WEBDAV_URL, fallback to generic NZBDAV_URL
        const specific = getOrSetSetting("NZBDAV_WEBDAV_URL", "", "Specific WebDAV URL");
        return (specific || this.NZBDAV_URL).trim();
    },

    get USE_STRM_FILES() {
        return getOrSetSetting("USE_STRM_FILES", "false", "Use .strm files instead of direct links") === "true";
    },

    get NZB_CHECK_URL() {
        return getOrSetSetting("NZB_CHECK_URL", "https://checknzb.filmwhisper.dev", "URL to the NZB Checking service");
    },

    get NZB_CHECK_API_KEY() {
        return getOrSetSetting("NZB_CHECK_API_KEY", "", "API key for the NZBCheck Service");
    },

    // --- Hardcoded Logic / Constants (Not in DB) ---
    // These are unlikely to change or are complex objects
    NZBDAV_POLL_INTERVAL_MS: 2000,
    NZBDAV_POLL_TIMEOUT_MS: 80000,
    NZBDAV_CACHE_TTL_MS: 3600000,
    NZBDAV_MAX_DIRECTORY_DEPTH: 6,
    NZBDAV_WEBDAV_ROOT: "/",
    NZBDAV_API_TIMEOUT_MS: 80000,
    NZBDAV_HISTORY_TIMEOUT_MS: 60000,
    FAILURE_VIDEO_FILENAME: "failure_video.mp4",
    NZBDAV_CACHE_MAX_ITEMS: 100,
    STREAM_METADATA_CACHE_MAX_ITEMS: 500,
    STREAM_METADATA_CACHE_TTL_MS: 60000,

    NZBDAV_VIDEO_EXTENSIONS: new Set([
        '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv',
        '.webm', '.m4v', '.ts', '.m2ts', '.mpg', '.mpeg'
    ]),

    VIDEO_MIME_MAP: new Map([
        [".mp4", "video/mp4"],
        [".m4v", "video/mp4"],
        [".mkv", "video/x-matroska"],
        [".webm", "video/webm"],
        [".avi", "video/x-msvideo"],
        [".mov", "video/quicktime"],
        [".wmv", "video/x-ms-wmv"],
        [".flv", "video/x-flv"],
        [".ts", "video/mp2t"],
        [".m2ts", "video/mp2t"],
        [".mpg", "video/mpeg"],
        [".mpeg", "video/mpeg"],
    ]),
};

export function validateConfig(): string[] {
    const missing: string[] = [];

    if (!Config.ADDON_BASE_URL) missing.push("ADDON_BASE_URL");
    if (!Config.REDIS_URL) missing.push("REDIS_URL");
    if (!Config.ADDON_SHARED_SECRET) missing.push("ADDON_SHARED_SECRET");
    if (!Config.NZBDAV_API_KEY) missing.push("NZBDAV_API_KEY");
    if (!Config.NZBDAV_URL) missing.push("NZBDAV_URL");
    if (!Config.NZBDAV_WEBDAV_PASS) missing.push("NZBDAV_WEBDAV_PASS");
    if (!Config.NZBDAV_WEBDAV_USER) missing.push("NZBDAV_WEBDAV_USER");

    return missing;
}
