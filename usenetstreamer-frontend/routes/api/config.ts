// routes/api/config.ts
import { define } from "../../utils.ts";
import { Context, Handlers } from "fresh/server";

import { getOrSetSetting, updateSetting } from "../../utils/sqlite.ts";
import { Config } from "../../utils/configTypes.ts";


const CONFIG_KEYS_METADATA = {
    PROWLARR_URL: { defaultValue: "http://prowlarr:9696", description: "URL for Prowlarr instance" },
    PROWLARR_API_KEY: { defaultValue: "", description: "API Key for Prowlarr" },
    NZBDAV_URL: { defaultValue: "http://altmount:8080/sabnzbd", description: "URL for NZBDav/Sabnzbd API" },
    NZBDAV_API_KEY: { defaultValue: "", description: "API Key for NZBDav" },
    NZBDAV_WEBDAV_URL: { defaultValue: "http://altmount:8080/webdav", description: "WebDAV URL for streaming" },
    NZBDAV_WEBDAV_USER: { defaultValue: "", description: "WebDAV Username" },
    NZBDAV_WEBDAV_PASS: { defaultValue: "", description: "WebDAV Password" },
    ADDON_BASE_URL: { defaultValue: "https://myusenet.duckdns.org", description: "Public HTTPS URL for Stremio addon" },
    ADDON_SHARED_SECRET: { defaultValue: "", description: "Shared Secret for Stremio addon API" },
    NZB_CHECK_URL: { defaultValue: "https://nzbcheck.filmwhisper.dev", description: "URL for NZBCheck API" },
    NZB_CHECK_API_KEY: { defaultValue: "", description: "API Key for NZBCheck" },
    NZBHYDRA_URL: { defaultValue: "", description: "URL for NZBHydra2" },
    NZBHYDRA_API_KEY: { defaultValue: "", description: "API Key for NZBHydra2" },
    USE_STRM_FILES: { defaultValue: "false", description: "Enable experimental .strm file support (true/false)" },
    INDEXING_METHOD: { defaultValue: "prowlarr", description: "Selected indexing method (prowlarr, nzbhydra2, direct)" },
    REDIS_URL: { defaultValue: "redis://redis:6379", description: "Redis connection string" },
    USE_STREMIO_NNTP: { defaultValue: "false", description: "Use built in Stremio NNTP (no nzbdav needed)" }
};

export const handler: Handlers = define.handlers({
    GET(_ctx: Context<unknown, unknown>) {
        try {
            const currentConfig: Config = {
                PROWLARR_URL: getOrSetSetting("PROWLARR_URL", CONFIG_KEYS_METADATA.PROWLARR_URL.defaultValue, CONFIG_KEYS_METADATA.PROWLARR_URL.description),
                PROWLARR_API_KEY: getOrSetSetting("PROWLARR_API_KEY", CONFIG_KEYS_METADATA.PROWLARR_API_KEY.defaultValue, CONFIG_KEYS_METADATA.PROWLARR_API_KEY.description),
                NZBDAV_URL: getOrSetSetting("NZBDAV_URL", CONFIG_KEYS_METADATA.NZBDAV_URL.defaultValue, CONFIG_KEYS_METADATA.NZBDAV_URL.description),
                NZBDAV_API_KEY: getOrSetSetting("NZBDAV_API_KEY", CONFIG_KEYS_METADATA.NZBDAV_API_KEY.defaultValue, CONFIG_KEYS_METADATA.NZBDAV_API_KEY.description),
                NZBDAV_WEBDAV_URL: getOrSetSetting("NZBDAV_WEBDAV_URL", CONFIG_KEYS_METADATA.NZBDAV_WEBDAV_URL.defaultValue, CONFIG_KEYS_METADATA.NZBDAV_WEBDAV_URL.description),
                NZBDAV_WEBDAV_USER: getOrSetSetting("NZBDAV_WEBDAV_USER", CONFIG_KEYS_METADATA.NZBDAV_WEBDAV_USER.defaultValue, CONFIG_KEYS_METADATA.NZBDAV_WEBDAV_USER.description),
                NZBDAV_WEBDAV_PASS: getOrSetSetting("NZBDAV_WEBDAV_PASS", CONFIG_KEYS_METADATA.NZBDAV_WEBDAV_PASS.defaultValue, CONFIG_KEYS_METADATA.NZBDAV_WEBDAV_PASS.description),
                ADDON_BASE_URL: getOrSetSetting("ADDON_BASE_URL", CONFIG_KEYS_METADATA.ADDON_BASE_URL.defaultValue, CONFIG_KEYS_METADATA.ADDON_BASE_URL.description),
                ADDON_SHARED_SECRET: getOrSetSetting("ADDON_SHARED_SECRET", CONFIG_KEYS_METADATA.ADDON_SHARED_SECRET.defaultValue, CONFIG_KEYS_METADATA.ADDON_SHARED_SECRET.description),
                NZB_CHECK_URL: getOrSetSetting("NZB_CHECK_URL", CONFIG_KEYS_METADATA.NZB_CHECK_URL.defaultValue, CONFIG_KEYS_METADATA.NZB_CHECK_URL.description),
                NZB_CHECK_API_KEY: getOrSetSetting("NZB_CHECK_API_KEY", CONFIG_KEYS_METADATA.NZB_CHECK_API_KEY.defaultValue, CONFIG_KEYS_METADATA.NZB_CHECK_API_KEY.description),
                NZBHYDRA_URL: getOrSetSetting("NZBHYDRA_URL", CONFIG_KEYS_METADATA.NZBHYDRA_URL.defaultValue, CONFIG_KEYS_METADATA.NZBHYDRA_URL.description),
                NZBHYDRA_API_KEY: getOrSetSetting("NZBHYDRA_API_KEY", CONFIG_KEYS_METADATA.NZBHYDRA_API_KEY.defaultValue, CONFIG_KEYS_METADATA.NZBHYDRA_API_KEY.description),
                USE_STRM_FILES: getOrSetSetting("USE_STRM_FILES", CONFIG_KEYS_METADATA.USE_STRM_FILES.defaultValue, CONFIG_KEYS_METADATA.USE_STRM_FILES.description) === "true",
                USE_STREMIO_NNTP: getOrSetSetting("USE_STREMIO_NNTP", CONFIG_KEYS_METADATA.USE_STREMIO_NNTP.defaultValue, CONFIG_KEYS_METADATA.USE_STREMIO_NNTP.description) === "true",
                INDEXING_METHOD: getOrSetSetting("INDEXING_METHOD", CONFIG_KEYS_METADATA.INDEXING_METHOD.defaultValue, CONFIG_KEYS_METADATA.INDEXING_METHOD.description),
                REDIS_URL: getOrSetSetting("REDIS_URL", CONFIG_KEYS_METADATA.REDIS_URL.defaultValue, CONFIG_KEYS_METADATA.REDIS_URL.description),
            };

            return new Response(JSON.stringify(currentConfig), {
                headers: { "Content-Type": "application/json" },
            });
        } catch (error) {
            console.error("Error fetching configuration:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            return new Response(JSON.stringify({ message: errorMessage || "Failed to fetch configuration" }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }
    },

    // Handler function receives Fresh's Context object
    async PUT(ctx: Context<unknown, unknown>) {
        try {
            // Access the request body via ctx.req
            const updatedConfig: Config = await ctx.req.json();

            // Iterate through the keys defined in CONFIG_KEYS_METADATA.
            // This ensures we only process and save expected fields, preventing injection.
            for (const key in CONFIG_KEYS_METADATA) {
                // Ensure key is a valid key for Config interface
                if (key in updatedConfig) {
                    const value = updatedConfig[key as keyof Config];

                    // Only update if the value is explicitly provided in the incoming request
                    // and not undefined, null, etc. based on your validation needs.
                    // For now, we allow empty strings for non-required fields.
                    if (value !== undefined) {
                        let stringValue: string;
                        if (typeof value === "boolean") {
                            stringValue = String(value); // Convert boolean (true/false) to "true"/"false" string for DB
                        } else if (typeof value === "string") {
                            stringValue = value;
                        } else {
                            // This case should ideally not be reached if Config interface is strictly followed
                            console.warn(`Skipping unexpected type for key '${key}': ${typeof value}`);
                            continue;
                        }
                        updateSetting(key, stringValue);
                    }
                }
            }

            return new Response(JSON.stringify({ message: "Configuration updated successfully" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        } catch (error) {
            console.error("Error saving configuration:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            return new Response(JSON.stringify({ message: errorMessage || "Failed to save configuration" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
    },
});
