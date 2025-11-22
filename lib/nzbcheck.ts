import type { SearchResult } from "../utils/getMediaAndSearchResults.ts";

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

export const checkNzb = async (items: NzbCheckItem[]) => {
    if (!NZB_CHECK_URL || !NZB_CHECK_API_KEY) {
        console.warn("NZB Check URL or API Key not set. Skipping NZB check.");
        return { success: false, data: {} };
    }

    try {
        const response = await fetch(`${NZB_CHECK_URL}/status/search`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-KEY": NZB_CHECK_API_KEY,
            },
            body: JSON.stringify({ items }),
        });

        if (!response.ok) {
            console.error("Failed to check NZBs:", response.statusText);
            return { success: false, data: {} };
        }

        const data = await response.json();
        return data as { success: boolean; data: Record<string, NZBCheckCache> };
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
        const response = await fetch(`${NZB_CHECK_URL}/status`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-KEY": NZB_CHECK_API_KEY,
            },
            body: JSON.stringify({ file_id: item.file_id, indexer: item.source_indexer, is_complete: isComplete, status_message: message }),
        });
        if (!response.ok) {
            console.error("Failed to update NZB status:", response.statusText);
            return { success: false };
        }
        const data = await response.json();
        return data as { success: boolean };
    } catch (error) {
        console.error("Error updating NZB status:", error);
        return { success: false };
    }
};
