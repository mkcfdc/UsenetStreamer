// deno-lint-ignore-file no-explicit-any
import { LRUCache as LRU } from "lru-cache";
import {
    getJsonValue,
    redis,
    setJsonValue,
} from "../../utils/redis.ts";
import { md5 } from "../../utils/md5Encoder.ts";

import { findBestVideoFile } from "../../utils/findBestVideoFile.ts";
import { streamFailureVideo } from "../streamFailureVideo.ts";
import { parseRequestedEpisode } from "../../utils/parseRequestedEpisode.ts";
import { proxyNzbdavStream } from "./proxyNzbdav.ts";
import { buildNzbdavApiParams, getNzbdavCategory, sleep } from "./nzbUtils.ts";
import { updateNzbStatus } from "../nzbcheck.ts";

import type { EpisodeInfo } from "../../utils/parseRequestedEpisode.ts";
import { fetcher } from "../../utils/fetcher.ts";

import {
    NZBDAV_POLL_TIMEOUT_MS,
    NZBDAV_URL,
    NZBDAV_API_KEY,
    NZBDAV_API_TIMEOUT_MS,
    NZBDAV_POLL_INTERVAL_MS,
    NZBDAV_CACHE_TTL_MS,
    STREAM_METADATA_CACHE_TTL_MS,
    NZBDAV_CACHE_MAX_ITEMS,
    STREAM_METADATA_CACHE_MAX_ITEMS,
    ADDON_BASE_URL,
    USE_STRM_FILES,
} from "../../env.ts";


interface StreamCache {
    downloadUrl: string;
    size: number;
    guid?: string;
    indexer?: string;
    title: string;
    fileName: string;
    prowlarrId?: string;
    nzbId?: string;
    type: "series" | "movie";
    rawImdbId?: string;
}

interface StreamResult {
    nzoId?: string;
    guid?: string;
    indexer?: string;
    category: string;
    jobName: string;
    viewPath: string;
    size?: number;
    fileName: string;
    downloadUrl?: string;
    title?: string;
    rawImdbId?: string;
    inFileSystem?: boolean;
}

interface NzbHistorySlot {
    nzoId: string;
    status: string;
    failMessage?: string;
    category: string;
    jobName: string;
    name?: string;
}

class NzbdavError extends Error {
    isNzbdavFailure = true;
    failureMessage: string;
    nzoId?: string;
    category?: string;

    constructor(message: string, failMessage: string, nzoId?: string, category?: string) {
        super(message);
        this.failureMessage = failMessage;
        this.nzoId = nzoId;
        this.category = category;
    }
}

const nzbdavStreamCache = new LRU<string, { status: "ready" | "pending" | "failed"; data?: StreamResult; promise?: Promise<StreamResult>; error?: any }>({
    max: NZBDAV_CACHE_MAX_ITEMS,
    ttl: NZBDAV_CACHE_TTL_MS,
});

const streamMetadataCache = new LRU<string, { data: StreamCache }>({
    max: STREAM_METADATA_CACHE_MAX_ITEMS,
    ttl: STREAM_METADATA_CACHE_TTL_MS,
});

/**
 * Recursively normalizes object keys to camelCase and maps specific inconsistencies 
 * (e.g. nzo_id -> nzoId) to a standard format.
 */
function normalizeKeys(obj: any): any {
    if (Array.isArray(obj)) return obj.map(normalizeKeys);
    if (obj !== null && typeof obj === "object") {
        return Object.keys(obj).reduce((acc, key) => {
            // Normalize key string
            const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
            let newKey = key;

            if (["nzoid", "id", "nzo_id"].includes(lowerKey)) newKey = "nzoId";
            else if (["failmessage", "fail_message"].includes(lowerKey)) newKey = "failMessage";
            else if (["jobname", "name", "nzbname"].includes(lowerKey)) newKey = "jobName";
            else if (["category", "cat"].includes(lowerKey)) newKey = "category";
            else if (["status"].includes(lowerKey)) newKey = "status";
            // Basic camelCase conversion for others if needed, or keep original

            acc[newKey] = normalizeKeys(obj[key]);
            return acc;
        }, {} as any);
    }
    return obj;
}


export async function fetchNzbdav<T = any>(
    mode: string,
    params: Record<string, string | number | boolean | undefined> = {},
    timeoutMs: number = 10000
): Promise<T> {
    const cleanParams = Object.fromEntries(
        Object.entries(params).filter(([_, v]) => v !== undefined)
    );

    const finalParams = buildNzbdavApiParams(mode, cleanParams as Record<string, any>);

    const data = await fetcher<any>(`${NZBDAV_URL}/api`, {
        params: finalParams,
        timeoutMs,
        headers: {
            "X-API-KEY": NZBDAV_API_KEY || "",
        },
    });

    const normalized = normalizeKeys(data);

    if (normalized?.error) {
        throw new Error(`[NZBDAV] API Error: ${normalized.error}`);
    }

    return normalized as T;
}

async function removeFailedProwlarrEntry(redisKey: string, downloadUrl: string) {
    // Lua script to find and remove an entry from a JSON array by downloadUrl
    const script = `
    local key = KEYS[1]
    local url = ARGV[1]
    
    if redis.call("EXISTS", key) == 0 then return 0 end
    
    local arr = redis.call('JSON.GET', key, '$')
    if not arr then return 0 end
    
    local decoded = cjson.decode(arr)
    -- JSON.GET returns an array of results, we want the first result
    local items = decoded[1] 
    
    if not items then return 0 end

    local idx = -1
    for i, item in ipairs(items) do
      if item.downloadUrl == url then 
        idx = i - 1 -- redis JSON is 0-indexed for path operations
        break 
      end
    end

    if idx >= 0 then
      redis.call('JSON.ARRPOP', key, '$', idx)
      local len = redis.call('JSON.ARRLEN', key, '$[0]') or 0
      if len == 0 then redis.call('DEL', key) end
      return 1
    end
    return 0
  `;
    await redis.eval(script, redisKey, [downloadUrl]);
}

async function addNzbToNzbdav(nzbUrl: string, category: string, jobLabel: string): Promise<{ nzoId: string }> {
    if (!nzbUrl) throw new Error("Missing NZB download URL");
    if (!category) throw new Error("Missing NZBDav category");

    const jobName = jobLabel || "untitled";
    console.log(`[NZBDAV] Queueing NZB for category=${category} (${jobName})`);

    const json = await fetchNzbdav("addurl", {
        name: nzbUrl,
        cat: category,
        nzbname: jobName,
    }, NZBDAV_API_TIMEOUT_MS);

    if (!json?.status) {
        throw new Error(`[NZBDAV] Failed to queue NZB: Status missing`);
    }

    const nzoId = json.nzoId || (Array.isArray(json.nzo_ids) && json.nzo_ids[0]);

    if (!nzoId) {
        console.debug(`[NZBDAV] Response dump:`, json);
        throw new Error("[NZBDAV] addurl succeeded but no nzoId returned");
    }

    console.log(`[NZBDAV] NZB queued with id ${nzoId}`);
    return { nzoId };
}

export async function waitForNzbdavHistorySlot(
    nzoId: string,
    category: string,
    signal?: AbortSignal
): Promise<NzbHistorySlot> {
    const deadline = Date.now() + NZBDAV_POLL_TIMEOUT_MS;
    let currentInterval = NZBDAV_POLL_INTERVAL_MS;
    const MAX_INTERVAL = 8000; // Cap polling at 8 seconds

    console.debug(`[NZBDAV] Polling history for ${nzoId}.`);

    while (Date.now() < deadline) {
        signal?.throwIfAborted();

        try {
            const json = await fetchNzbdav("history", {
                start: "0",
                limit: "100",
                category: category,
                nzo_ids: nzoId,
            }, currentInterval);

            const history = json.history || {};
            const slots: NzbHistorySlot[] = history.slots || [];

            // Find the specific job
            const slot = slots.find((entry) => entry.nzoId === nzoId);

            if (slot) {
                const status = String(slot.status || "").toLowerCase();

                if (status === "completed" || status === "success") {
                    console.log(`[NZBDAV] NZB ${nzoId} completed in ${category}`);
                    return slot;
                }

                if (status === "failed" || status === "error") {
                    const failMessage = slot.failMessage || "Unknown NZBDav error";
                    throw new NzbdavError(`[NZBDAV] NZB failed: ${failMessage}`, failMessage, nzoId, category);
                }

                console.log(`[NZBDAV:history] NZB ${nzoId} status: ${status}.`);
            } else {
                // Job not in history usually means it is still in the "queue" (downloading)
                console.debug(`[NZBDAV:history] Job ${nzoId} not found in history yet.`);
            }

        } catch (err) {
            if (err instanceof NzbdavError) throw err;
            if ((err as Error).name === "AbortError") throw err;

            // Log warning but continue polling
            console.warn(`[NZBDAV] Poll warning: ${err instanceof Error ? err.message : err}`);
        }

        // Wait with abort signal support
        await sleep(currentInterval, signal);
        currentInterval = Math.min(currentInterval * 1.5, MAX_INTERVAL);
    }

    throw new Error(`[NZBDAV] Timeout waiting for NZB ${nzoId}`);
}

async function buildNzbdavStream(params: {
    downloadUrl: string;
    category: string;
    title: string;
    indexer?: string;
    fileId?: string;
    requestedEpisode: EpisodeInfo | undefined;
    signal?: AbortSignal;
}): Promise<StreamResult> {
    const { downloadUrl, category, title, requestedEpisode, indexer, fileId, signal } = params;
    const cacheKey = `streams:${md5(downloadUrl)}`;

    // 1. Determine correct Job Name logic
    // If using AltMount, we force the use of the MD5 hash as the job name.
    // This ensures the folder on disk matches what we search for, preventing "Human Title" vs "Hash" mismatches.
    const isAltMount = NZBDAV_URL.includes("altmount");
    const intendedJobName = isAltMount ? md5(downloadUrl) : title;

    // 2. Check Persistence Cache (Redis)
    const cached = await getJsonValue<StreamResult | StreamResult[]>(cacheKey, "$");
    const validCache = Array.isArray(cached) ? cached[0] : cached;

    if (validCache?.viewPath) {
        console.log(`[NZBDAV] Instant cache hit: ${validCache.viewPath}`);
        return validCache;
    }

    // 3. Check File System / AltMount pre-existence
    const existingFile = await findBestVideoFile({ category, jobName: intendedJobName, requestedEpisode });

    if (existingFile?.viewPath) {
        const typeLabel = USE_STRM_FILES ? "STRM" : isAltMount ? "AltMount" : "NZBDAV";
        console.log(`[${typeLabel}] Pre-cache hit: ${existingFile.viewPath}`);

        const result: StreamResult = {
            viewPath: existingFile.viewPath,
            fileName: existingFile.viewPath.split("/").pop() ?? "video.mkv",
            inFileSystem: !USE_STRM_FILES,
            category,
            jobName: intendedJobName
        };

        await setJsonValue(cacheKey, "$.viewPath", existingFile.viewPath);
        return result;
    }

    // 4. Proxy Download (Add to NZBDav) 
    const proxyUrl = `${ADDON_BASE_URL}/nzb/proxy/${md5(downloadUrl)}.nzb`;
    // Pass intendedJobName (hash if altmount) instead of title
    const { nzoId } = await addNzbToNzbdav(proxyUrl, category, intendedJobName);

    // 5. Wait for completion
    const slot = await waitForNzbdavHistorySlot(nzoId, category, signal);

    const slotCategory = slot.category || category;

    // --- SANITIZATION FIX ---
    // Sometimes downloaders return paths like "tmp/content/Movies/hash.nzb" as the name.
    // We must clean this up before searching.
    let searchName = slot.jobName || slot.name || intendedJobName;

    // 1. Remove .nzb extension if present (downloader often reports filename as name)
    if (searchName.endsWith(".nzb")) {
        searchName = searchName.slice(0, -4);
    }

    // 2. If it contains slashes (path leak), take the last segment (basename)
    if (searchName.includes("/") || searchName.includes("\\")) {
        console.warn(`[NZBDAV] Job name contained path characters: "${searchName}". Sanitizing.`);
        searchName = searchName.split(/[/\\]/).pop() || searchName;
    }

    // 3. If AltMount is on, prefer the intended Hash over whatever the downloader reported 
    // (unless the downloader completely renamed it, but AltMount relies on Hashes)
    if (isAltMount && intendedJobName && searchName !== intendedJobName) {
        console.log(`[NZBDAV] Enforcing AltMount hash for search: ${intendedJobName} (ignoring history name: ${searchName})`);
        searchName = intendedJobName;
    }

    if (!searchName) throw new Error("[NZBDAV] No job name available for file search");

    // 6. Find final file path
    const bestFile = await findBestVideoFile({
        category: slotCategory,
        jobName: searchName,
        requestedEpisode,
    });

    if (!bestFile) {
        console.error(`[NZBDAV] Search failed for: Category=${slotCategory}, Job=${searchName}`);
        throw new Error("[NZBDAV] Download complete but no video file found");
    }

    const result: StreamResult = {
        nzoId,
        category: slotCategory,
        jobName: searchName,
        viewPath: bestFile.viewPath,
        size: Number(bestFile.size) || 0,
        fileName: bestFile.name,
        downloadUrl: downloadUrl,
        guid: fileId,
        indexer: indexer,
        title: title,
        rawImdbId: (validCache as any)?.rawImdbId,
    };

    await setJsonValue(cacheKey, "$", result);
    console.log(`[NZBDAV] Stream ready: ${result.viewPath}`);

    if (indexer && fileId) {
        console.log(`[NZBDAV] Updating NZB status: indexer=${indexer}, fileId=${fileId}`);
        await updateNzbStatus({ source_indexer: indexer, file_id: fileId }, true, "All files present. Ready to stream.");
    }

    return result;
}


async function getOrCreateNzbdavStream(
    cacheKey: string,
    builder: () => Promise<StreamResult>
): Promise<StreamResult> {
    const existing = nzbdavStreamCache.get(cacheKey);

    if (existing) {
        if (existing.status === "ready" && existing.data) return existing.data;
        if (existing.status === "pending" && existing.promise) return existing.promise;
        if (existing.status === "failed") throw existing.error;
    }

    const promise = builder().then((data) => {
        nzbdavStreamCache.set(cacheKey, { status: "ready", data });
        return data;
    });

    nzbdavStreamCache.set(cacheKey, { status: "pending", promise });

    try {
        return await promise;
    } catch (error: any) {
        // Only cache logic failures, not transient network errors if possible
        // But strict duplicate prevention requires us to handle failures carefully
        if (error?.isNzbdavFailure) {
            nzbdavStreamCache.set(cacheKey, { status: "failed", error });
        } else {
            nzbdavStreamCache.delete(cacheKey);
        }
        throw error;
    }
}

export async function streamNzbdavProxy(keyHash: string, req: Request): Promise<Response> {
    const redisKey = `streams:${keyHash}`;

    let meta = streamMetadataCache.get(redisKey)?.data || null;
    if (!meta) {
        meta = await getJsonValue<StreamCache>(redisKey);
        if (meta) streamMetadataCache.set(redisKey, { data: meta });
    }

    if (!meta) {
        console.warn(`[StreamProxy] Missing metadata for key: ${keyHash}`);
        const failureResponse = await streamFailureVideo(req);
        if (failureResponse) return failureResponse;

        return new Response(JSON.stringify({ error: "Stream metadata missing or expired" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
        });
    }

    const { downloadUrl, type = "movie", title = "NZB Stream", prowlarrId, guid, indexer } = meta;
    const id = meta.rawImdbId ?? "";
    const category = getNzbdavCategory(type);
    const episode = parseRequestedEpisode(type, id);

    // Use MD5 lock to prevent parallel downloads of same file
    const lockKey = `stream_build:${md5(downloadUrl)}`;

    try {
        const streamData = await getOrCreateNzbdavStream(lockKey, () =>
            buildNzbdavStream({
                downloadUrl,
                category,
                title,
                requestedEpisode: episode,
                indexer,
                fileId: guid,
                signal: req.signal
            })
        );

        return await proxyNzbdavStream(
            req,
            streamData.viewPath,
            streamData.fileName ?? "video.mkv",
            streamData.inFileSystem
        );

    } catch (err: any) {
        const msg = err.message ?? String(err);
        const isNzbdavFail = !!err.isNzbdavFailure;

        if (isNzbdavFail) {
            console.warn("[NZBDAV] Job Failed:", err.failureMessage || msg);

            const fileId = guid || "";
            if (indexer && fileId) {
                console.log(`[NZBDAV] Updating NZB status: indexer=${indexer}, fileId=${fileId}`);
                await updateNzbStatus({ source_indexer: indexer, file_id: fileId }, false, err.failureMessage || msg);
            }

            await redis.del(redisKey);

            if (prowlarrId && downloadUrl) {
                const searchKey = `prowlarr:search:${id}`;
                await removeFailedProwlarrEntry(searchKey, downloadUrl);
            }

            const failureResponse = await streamFailureVideo(req, err);
            if (failureResponse) return failureResponse;
        } else {
            console.error("[NZBDAV] Proxy error:", msg);
        }

        const status = err.response?.status || 502;
        return new Response(JSON.stringify({ error: err.failureMessage || msg }), {
            status,
            headers: { "Content-Type": "application/json" },
        });
    }
}