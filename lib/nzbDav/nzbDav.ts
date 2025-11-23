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
    NZBDAV_HISTORY_TIMEOUT_MS,
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
    nzo_id?: string;
    nzoId?: string;
    NzoId?: string;
    status?: string;
    Status?: string;
    fail_message?: string;
    failMessage?: string;
    FailMessage?: string;
    category?: string;
    Category?: string;
    job_name?: string;
    JobName?: string;
    name?: string;
    Name?: string;
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

const nzbdavStreamCache = new LRU<string, any>({
    max: NZBDAV_CACHE_MAX_ITEMS,
    ttl: NZBDAV_CACHE_TTL_MS,
});

const streamMetadataCache = new LRU<string, { data: StreamCache }>({
    max: STREAM_METADATA_CACHE_MAX_ITEMS,
    ttl: STREAM_METADATA_CACHE_TTL_MS,
});

export async function fetchNzbdav<T = any>(
    mode: string,
    params: Record<string, string | number | boolean | undefined> = {},
    timeoutMs: number = 10000
): Promise<T> {
    const cleanParams: Record<string, any> = {};
    for (const [key, val] of Object.entries(params)) {
        if (val !== undefined) cleanParams[key] = val;
    }

    const finalParams = buildNzbdavApiParams(mode, cleanParams);

    // 3. Use fetcher
    const data = await fetcher<T & { error?: string }>(`${NZBDAV_URL}/api`, {
        params: finalParams,
        timeoutMs,
        headers: {
            "X-API-KEY": NZBDAV_API_KEY || ""
        },
    });

    if (data?.error) {
        throw new Error(`[NZBDAV] API Error: ${data.error}`);
    }

    return data;
}

async function removeFailedProwlarrEntry(redisKey: string, downloadUrl: string) {
    const script = `
    local key = KEYS[1]
    local url = ARGV[1]
    local arr = redis.call('JSON.GET', key, '$[0]') or '[]'
    arr = cjson.decode(arr)
    local idx = -1
    for i = 1, #arr do
      if arr[i].downloadUrl == url then idx = i-1 break end
    end
    if idx >= 0 then
      redis.call('JSON.ARRPOP', key, '$', idx)
      local len = redis.call('JSON.ARRLEN', key, '$[0]') or 0
      if len == 0 then redis.call('DEL', key) end
      return 1
    end
    return 0
  `;
    await redis.eval(script, 1, redisKey, downloadUrl);
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

    // Handle inconsistent casing in API response
    const nzoId =
        json.nzo_id ||
        json.nzoId ||
        json.NzoId ||
        (Array.isArray(json.nzo_ids) && json.nzo_ids[0]) ||
        (Array.isArray(json.queue) && json.queue[0]?.nzo_id);

    if (!nzoId) {
        console.debug(`[NZBDAV] Response dump:`, json);
        throw new Error("[NZBDAV] addurl succeeded but no nzo_id returned");
    }

    console.log(`[NZBDAV] NZB queued with id ${nzoId}`);
    return { nzoId };
}

async function waitForNzbdavHistorySlot(
    nzoId: string,
    category: string,
    downloadUrl: string
): Promise<NzbHistorySlot> {
    const deadline = Date.now() + NZBDAV_POLL_TIMEOUT_MS;

    console.debug(`[NZBDAV] Polling history for ${nzoId}.`);

    while (Date.now() < deadline) {
        const json = await fetchNzbdav("history", {
            start: "0",
            limit: "100",
            category: category,
            nzo_ids: nzoId,
        }, NZBDAV_HISTORY_TIMEOUT_MS || NZBDAV_POLL_INTERVAL_MS);

        const history = json?.history || json?.History;
        if (!history) throw new Error(`[NZBDAV] History property missing`);

        const slots: NzbHistorySlot[] = history.slots || history.Slots || [];

        // Find our specific job
        const slot = slots.find((entry) => {
            const entryId = entry.nzo_id || entry.nzoId || entry.NzoId;
            return entryId === nzoId;
        });

        if (slot) {
            const status = (slot.status || slot.Status || "").toString().toLowerCase();

            if (status === "completed" || status === "success") {
                console.log(`[NZBDAV] NZB ${nzoId} completed in ${category}`);
                return slot;
            }

            if (status === "failed" || status === "error") {
                const failMessage = slot.fail_message || slot.failMessage || slot.FailMessage || "Unknown NZBDav error";

                // Report failure externally
                //await updateNzbStatus({ source_indexer: nzbUrl, file_id: fileId }, false, failMessage);
                throw new NzbdavError(`[NZBDAV] NZB failed: ${failMessage}`, failMessage, nzoId, category);
            }

            console.log(`[NZBDAV:history] NZB ${nzoId} status: ${status}. Polling...`);
        } else {
            console.warn(`[NZBDAV:history] Job ${nzoId} not found in history yet.`);
        }

        await sleep(NZBDAV_POLL_INTERVAL_MS);
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
}): Promise<StreamResult> {
    const { downloadUrl, category, title, requestedEpisode, indexer, fileId } = params;
    const cacheKey = `streams:${md5(downloadUrl)}`;

    // 1. Check Persistence Cache (Redis)
    const cached = await getJsonValue<StreamResult>(cacheKey, "$");
    // If the cached item has a specific view path, it's ready
    if (cached && Array.isArray(cached) ? cached[0]?.viewPath : cached?.viewPath) {
        const validCache = Array.isArray(cached) ? cached[0] : cached;
        console.log(`[NZBDAV] Instant cache hit: ${validCache.viewPath}`);
        return validCache;
    }

    // 2. Check File System / AltMount pre-existence
    const isAltMount = NZBDAV_URL.includes("altmount");
    const jobName = isAltMount ? md5(downloadUrl) : title;

    const existingFile = await findBestVideoFile({ category, jobName, requestedEpisode });

    if (existingFile?.viewPath) {
        const typeLabel = USE_STRM_FILES ? "STRM" : isAltMount ? "AltMount" : "NZBDAV";
        console.log(`[${typeLabel}] Pre-cache hit: ${existingFile.viewPath}`);

        const result: StreamResult = {
            viewPath: existingFile.viewPath,
            fileName: existingFile.viewPath.split("/").pop() ?? "video.mkv",
            inFileSystem: !USE_STRM_FILES,
            category,
            jobName
        };

        // Cache this success
        await setJsonValue(cacheKey, "$.viewPath", existingFile.viewPath);
        return result;
    }

    // 3. Proxy Download (Add to NZBDav) 
    const proxyUrl = `${ADDON_BASE_URL}/nzb/proxy/${md5(downloadUrl)}.nzb`;
    const { nzoId } = await addNzbToNzbdav(proxyUrl, category, title);

    // 4. Wait for completion
    const slot = await waitForNzbdavHistorySlot(nzoId, category, downloadUrl);

    const slotCategory = slot.category || slot.Category || category;
    const slotJobName = slot.job_name || slot.JobName || slot.name || slot.Name;
    if (!slotJobName) throw new Error("[NZBDAV] No job name returned from history");

    // 5. Find final file path
    const bestFile = await findBestVideoFile({
        category: slotCategory,
        jobName: slotJobName,
        requestedEpisode,
    });

    if (!bestFile) throw new Error("[NZBDAV] Download complete but no video file found");

    const result: StreamResult = {
        nzoId,
        category: slotCategory,
        jobName: slotJobName,
        viewPath: bestFile.viewPath,
        size:
            bestFile.size === undefined
                ? 0
                : typeof bestFile.size === "string"
                    ? Number(bestFile.size) || 0
                    : bestFile.size,
        fileName: bestFile.name,
        downloadUrl: downloadUrl,
        guid: fileId,
        indexer: indexer,
        title: title,
        rawImdbId: (cached as any)?.rawImdbId,
    };

    await setJsonValue(cacheKey, "$", result);
    console.log(`[NZBDAV] Stream ready: ${result.viewPath}`);
    // tell the nzbcheck system that the file is ready
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
        if (existing.status === "ready") return existing.data;
        if (existing.status === "pending") return existing.promise;
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
        // Only cache failures if they are specific NZBDav logic failures
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

    const concurrencyKey = [
        downloadUrl,
        category,
        episode ? `${episode.season}x${episode.episode}` : "full",
    ].join("|");

    try {
        // 3. Execute Stream Build
        const streamData = await getOrCreateNzbdavStream(concurrencyKey, () =>
            buildNzbdavStream({ downloadUrl, category, title, requestedEpisode: episode, indexer: indexer, fileId: guid })
        );

        // 4. Proxy the Stream
        return await proxyNzbdavStream(
            req,
            streamData.viewPath,
            streamData.fileName ?? "",
            streamData.inFileSystem
        );

    } catch (err: any) {
        const msg = err.message ?? String(err);
        const isNzbdavFail = !!err.isNzbdavFailure;

        if (isNzbdavFail) {
            console.warn("[NZBDAV] Job Failed:", err.failureMessage || msg);

            // update the nzbcheck system about the failure
            const fileId = guid || "";
            if (indexer && fileId) {
                console.log(`[NZBDAV] Updating NZB status: indexer=${indexer}, fileId=${fileId}`);
                await updateNzbStatus({ source_indexer: indexer, file_id: fileId }, false, err.failureMessage || msg);
            }

            // Clean up Redis
            await redis.del(redisKey);

            // Clean up Prowlarr results if applicable
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
