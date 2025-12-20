import { fetcher } from "../utils/fetcher.ts";
import { Config } from "../env.ts";

// --- Types ---

export interface NzbCheckItem {
    source_indexer: string;
    file_id: string;
}

export interface NzbCheckStatus {
    is_complete: boolean | null;
    cache_hit: boolean;
    last_updated: string | null;
}

interface NzbCheckResponse {
    success: boolean;
    data: Record<string, NzbCheckStatus>;
}

interface NzbStatusResponse {
    success: boolean;
}

// --- Constants ---

const EMPTY_RESPONSE: NzbCheckResponse = { success: false, data: {} };
const FAILED_STATUS: NzbStatusResponse = { success: false };

const API_HEADERS = Config.NZB_CHECK_API_KEY
    ? { "X-API-KEY": Config.NZB_CHECK_API_KEY }
    : undefined;

const isConfigured = Boolean(Config.NZB_CHECK_URL && Config.NZB_CHECK_API_KEY);

// Log once at startup instead of per-request
if (!isConfigured) {
    console.warn("[NzbCheck] URL or API Key not configured - checks disabled");
}

// --- Helpers ---

function buildUrl(path: string): string {
    return `${Config.NZB_CHECK_URL}${path}`;
}

// --- Exports ---

/**
 * Batch check NZB completion status
 */
export async function checkNzb(items: NzbCheckItem[]): Promise<NzbCheckResponse> {
    if (!isConfigured || items.length === 0) {
        return EMPTY_RESPONSE;
    }

    try {
        return await fetcher<NzbCheckResponse>(buildUrl("/status/search"), {
            method: "POST",
            headers: API_HEADERS,
            body: { items },
            timeoutMs: 10000,
        });
    } catch (err) {
        console.error("[NzbCheck] Batch check failed:", err instanceof Error ? err.message : err);
        return EMPTY_RESPONSE;
    }
}

/**
 * Update single NZB completion status
 */
export async function updateNzbStatus(
    item: NzbCheckItem,
    isComplete: boolean,
    message: string,
): Promise<NzbStatusResponse> {
    if (!isConfigured) {
        return FAILED_STATUS;
    }

    try {
        return await fetcher<NzbStatusResponse>(buildUrl("/status"), {
            method: "POST",
            headers: API_HEADERS,
            body: {
                file_id: item.file_id,
                indexer: item.source_indexer,
                is_complete: isComplete,
                status_message: message,
            },
            timeoutMs: 5000,
        });
    } catch (err) {
        console.error("[NzbCheck] Status update failed:", err instanceof Error ? err.message : err);
        return FAILED_STATUS;
    }
}

/**
 * Fire-and-forget status update - use when you don't need confirmation
 */
export function updateNzbStatusAsync(
    item: NzbCheckItem,
    isComplete: boolean,
    message: string,
): void {
    if (!isConfigured) return;

    fetcher(buildUrl("/status"), {
        method: "POST",
        headers: API_HEADERS,
        body: {
            file_id: item.file_id,
            indexer: item.source_indexer,
            is_complete: isComplete,
            status_message: message,
        },
        timeoutMs: 5000,
    }).catch(() => { }); // Swallow errors silently
}

/**
 * Batch update multiple statuses in parallel
 */
export async function updateNzbStatusBatch(
    updates: Array<{
        item: NzbCheckItem;
        isComplete: boolean;
        message: string;
    }>,
): Promise<{ succeeded: number; failed: number }> {
    if (!isConfigured || updates.length === 0) {
        return { succeeded: 0, failed: updates.length };
    }

    const results = await Promise.allSettled(
        updates.map(({ item, isComplete, message }) =>
            updateNzbStatus(item, isComplete, message)
        )
    );

    let succeeded = 0;
    let failed = 0;

    for (const result of results) {
        if (result.status === "fulfilled" && result.value.success) {
            succeeded++;
        } else {
            failed++;
        }
    }

    return { succeeded, failed };
}
