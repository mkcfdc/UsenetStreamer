import { fetcher } from "../utils/fetcher.ts";
import { Config, nzbCheckEnabled } from "../env.ts";
import { keys, NZBCHECK_TTL_SEC } from "../utils/cacheKeys.ts";
import { getJsonValues, setJsonValue } from "../utils/redis.ts";

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

const EMPTY_RESPONSE: NzbCheckResponse = { success: false, data: {} };
const FAILED_STATUS: NzbStatusResponse = { success: false };

function apiHeaders(): Record<string, string> | undefined {
    const key = Config.NZB_CHECK_API_KEY;
    return key ? { "X-API-KEY": key } : undefined;
}

function buildUrl(path: string): string {
    return `${Config.NZB_CHECK_URL}${path}`;
}

export async function checkNzb(items: NzbCheckItem[]): Promise<NzbCheckResponse> {
    if (!nzbCheckEnabled() || items.length === 0) {
        return EMPTY_RESPONSE;
    }

    const cacheKeys = items.map((item) => keys.nzbcheck(item.source_indexer, item.file_id));
    const cached = await getJsonValues<NzbCheckStatus>(cacheKeys);

    const data: Record<string, NzbCheckStatus> = {};
    const missing: NzbCheckItem[] = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const hit = cached[i];
        const id = `${item.source_indexer.toLowerCase()}:${item.file_id}`;
        if (hit) {
            data[id] = { ...hit, cache_hit: true };
        } else {
            missing.push(item);
        }
    }

    if (missing.length === 0) {
        return { success: true, data };
    }

    try {
        const remote = await fetcher<NzbCheckResponse>(buildUrl("/status/search"), {
            method: "POST",
            headers: apiHeaders(),
            body: { items: missing },
            timeoutMs: 10000,
        });

        const remoteData = remote?.data ?? {};
        for (const item of missing) {
            const id = `${item.source_indexer.toLowerCase()}:${item.file_id}`;
            const status = remoteData[id];
            if (!status) continue;
            data[id] = status;
            setJsonValue(keys.nzbcheck(item.source_indexer, item.file_id), "$", status, NZBCHECK_TTL_SEC)
                .catch(() => {});
        }

        return { success: Boolean(remote?.success) || Object.keys(data).length > 0, data };
    } catch (err) {
        console.error("[NzbCheck] Batch check failed:", err instanceof Error ? err.message : err);
        return Object.keys(data).length ? { success: true, data } : EMPTY_RESPONSE;
    }
}

export async function updateNzbStatus(
    item: NzbCheckItem,
    isComplete: boolean,
    message: string,
): Promise<NzbStatusResponse> {
    if (!nzbCheckEnabled()) {
        return FAILED_STATUS;
    }

    try {
        return await fetcher<NzbStatusResponse>(buildUrl("/status"), {
            method: "POST",
            headers: apiHeaders(),
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

export function updateNzbStatusAsync(
    item: NzbCheckItem,
    isComplete: boolean,
    message: string,
): void {
    if (!nzbCheckEnabled()) return;

    fetcher(buildUrl("/status"), {
        method: "POST",
        headers: apiHeaders(),
        body: {
            file_id: item.file_id,
            indexer: item.source_indexer,
            is_complete: isComplete,
            status_message: message,
        },
        timeoutMs: 5000,
    }).catch(() => { });
}

export async function updateNzbStatusBatch(
    updates: Array<{
        item: NzbCheckItem;
        isComplete: boolean;
        message: string;
    }>,
): Promise<{ succeeded: number; failed: number }> {
    if (!nzbCheckEnabled() || updates.length === 0) {
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
