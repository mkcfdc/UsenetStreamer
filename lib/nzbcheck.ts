import type { SearchResult } from "../utils/getMediaAndSearchResults.ts";
import { fetcher } from "../utils/fetcher.ts";

const NZB_CHECK_URL = Deno.env.get("NZB_CHECK_URL");
const NZB_CHECK_API_KEY = Deno.env.get("NZB_CHECK_API_KEY");

interface NzbCheckItem {
    source_indexer: string;
    file_id: string;
}

interface NZBCheckCache extends SearchResult {
    is_complete: boolean | null;
    cache_hit: boolean;
    last_updated: string | null;
}

interface NzbCheckResponse {
    success: boolean;
    data: Record<string, NZBCheckCache>;
}

interface NzbStatusResponse {
    success: boolean;
}

export const checkNzb = async (items: NzbCheckItem[]) => {
    if (!NZB_CHECK_URL || !NZB_CHECK_API_KEY) {
        console.warn("NZB Check URL or API Key not set. Skipping NZB check.");
        return { success: false, data: {} };
    }

    try {
        const data = await fetcher<NzbCheckResponse>(`${NZB_CHECK_URL}/status/search`, {
            method: "POST",
            headers: {
                "X-API-KEY": NZB_CHECK_API_KEY,
            },
            body: { items },
        });

        return data;
    } catch (error) {
        console.error("Error checking NZBs:", error);
        return { success: false, data: {} };
    }
};

export const updateNzbStatus = async (item: NzbCheckItem, isComplete: boolean, message: string) => {
    if (!NZB_CHECK_URL || !NZB_CHECK_API_KEY) {
        console.warn("NZB Check URL or API Key not set. Skipping NZB status update.");
        return { success: false };
    }

    try {
        const data = await fetcher<NzbStatusResponse>(`${NZB_CHECK_URL}/status`, {
            method: "POST",
            headers: {
                "X-API-KEY": NZB_CHECK_API_KEY,
            },
            body: {
                file_id: item.file_id,
                indexer: item.source_indexer,
                is_complete: isComplete,
                status_message: message
            },
        });

        return data;
    } catch (error) {
        console.error("Error updating NZB status:", error);
        return { success: false };
    }
};
