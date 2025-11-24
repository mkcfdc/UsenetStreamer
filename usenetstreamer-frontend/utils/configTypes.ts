export interface Config {
    PROWLARR_URL: string;
    PROWLARR_API_KEY: string;
    NZBDAV_URL: string;
    NZBDAV_API_KEY: string;
    NZBDAV_WEBDAV_URL: string;
    NZBDAV_WEBDAV_USER: string;
    NZBDAV_WEBDAV_PASS: string;
    ADDON_BASE_URL: string;
    ADDON_SHARED_SECRET: string;
    NZB_CHECK_URL: string;
    NZB_CHECK_API_KEY: string;
    NZBHYDRA_URL?: string;
    NZBHYDRA_API_KEY?: string;
    USE_STRM_FILES: boolean;
    INDEXING_METHOD: string;
}

export type IndexingMethod = 'prowlarr' | 'nzbhydra2' | 'direct';