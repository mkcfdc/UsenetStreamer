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
import { parseRequestedEpisode, type EpisodeInfo } from "../../utils/parseRequestedEpisode.ts";
import { proxyNzbdavStream } from "./proxyNzbdav.ts";
import { buildNzbdavApiParams, getNzbdavCategory, sleep } from "./nzbUtils.ts";
import { updateNzbStatus } from "../nzbcheck.ts";
import { fetcher } from "../../utils/fetcher.ts";
import { Config } from "../../env.ts";

// --- Types ---

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

// --- Caches ---

const nzbdavStreamCache = new LRU<string, { status: "ready" | "pending" | "failed"; data?: StreamResult; promise?: Promise<StreamResult>; error?: any }>({
    max: Config.NZBDAV_CACHE_MAX_ITEMS,
    ttl: Config.NZBDAV_CACHE_TTL_MS,
});

const streamMetadataCache = new LRU<string, { data: StreamCache }>({
    max: Config.STREAM_METADATA_CACHE_MAX_ITEMS,
    ttl: Config.STREAM_METADATA_CACHE_TTL_MS,
});

// --- Helpers ---

/**
 * Minified Lua script to save bandwidth.
 */
const REMOVE_PROWLARR_SCRIPT = `local k=KEYS[1];if redis.call("EXISTS",k)==0 then return 0 end;local a=redis.call('JSON.GET',k,'$');if not a then return 0 end;local d=cjson.decode(a);local t=d[1];if not t then return 0 end;local x=-1;for i,v in ipairs(t) do if v.downloadUrl==ARGV[1] then x=i-1;break end end;if x>=0 then redis.call('JSON.ARRPOP',k,'$',x);local l=redis.call('JSON.ARRLEN',k,'$[0]') or 0;if l==0 then redis.call('DEL',k) end;return 1 end;return 0`;

function normalizeSlot(slot: any): NzbHistorySlot {
    return {
        nzoId: slot.nzo_id || slot.id || slot.nzoId || "",
        status: (slot.status || "").toLowerCase(),
        failMessage: slot.fail_message || slot.failMessage || "",
        category: slot.category || slot.cat || "",
        jobName: slot.job_name || slot.jobName || slot.name || slot.nzb_name || slot.nzbName || "",
        name: slot.name || ""
    };
}

export async function fetchNzbdav<T = any>(
    mode: string,
    params: Record<string, string | number | boolean | undefined> = {},
    timeoutMs: number = 10000
): Promise<T> {
    // 1. Build clean params
    const cleanParams: Record<string, any> = {};
    for (const k in params) {
        if (params[k] !== undefined) cleanParams[k] = params[k];
    }

    const finalParams = buildNzbdavApiParams(mode, cleanParams);

    // 2. Fetch with Dynamic Headers (Fix for 400 Bad Request)
    // We read Config.NZBDAV_API_KEY here to ensure it's loaded.
    try {
        const data = await fetcher<any>(`${Config.NZBDAV_URL}/api`, {
            params: finalParams,
            timeoutMs,
            headers: {
                "X-API-KEY": Config.NZBDAV_API_KEY || "",
            },
        });

        if (data?.error) {
            throw new Error(`[NZBDAV] API Error: ${data.error}`);
        }
        return data as T;
    } catch (e: any) {
        // Enhance error logging for debugging
        if (e.message.includes("400")) {
            console.error(`[NZBDAV] 400 Bad Request. Mode: ${mode}, Params:`, JSON.stringify(finalParams));
        }
        throw e;
    }
}

async function removeFailedProwlarrEntry(redisKey: string, downloadUrl: string) {
    try {
        await redis.eval(REMOVE_PROWLARR_SCRIPT, redisKey, [downloadUrl]);
    } catch (e) {
        console.warn(`[Redis] Failed to clean prowlarr entry:`, e);
    }
}

async function addNzbToNzbdav(nzbUrl: string, category: string, jobLabel: string): Promise<{ nzoId: string }> {
    if (!nzbUrl) throw new Error("Missing NZB download URL");

    const jobName = jobLabel || "untitled";
    console.log(`[NZBDAV] Queueing NZB for category=${category} (${jobName})`);

    const json = await fetchNzbdav("addurl", {
        name: nzbUrl,
        cat: category,
        nzbname: jobName,
    }, Config.NZBDAV_API_TIMEOUT_MS);

    // Fast check for ID variations
    const nzoId = json.nzo_ids?.[0] || json.nzoId || json.nzo_id;

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
    const deadline = Date.now() + Config.NZBDAV_POLL_TIMEOUT_MS;
    let currentInterval = Config.NZBDAV_POLL_INTERVAL_MS;
    const MAX_INTERVAL = 10000;

    console.debug(`[NZBDAV] Polling history for ${nzoId}.`);

    while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason;

        try {
            const json = await fetchNzbdav("history", {
                start: "0",
                limit: "1",
                category: category,
                nzo_ids: nzoId,
            }, currentInterval);

            const slots = json.history?.slots || json.slots || [];

            // Find our specific job
            const rawSlot = slots.find((entry: any) =>
                entry.nzo_id === nzoId || entry.id === nzoId || entry.nzoId === nzoId
            );

            if (rawSlot) {
                const slot = normalizeSlot(rawSlot);
                const status = slot.status;

                if (status === "completed" || status === "success") {
                    console.log(`[NZBDAV] NZB ${nzoId} completed in ${category}`);
                    return slot;
                }

                if (status === "failed" || status === "error") {
                    const failMessage = slot.failMessage || "Unknown NZBDav error";
                    throw new NzbdavError(`[NZBDAV] NZB failed: ${failMessage}`, failMessage, nzoId, category);
                }

                if (Math.random() > 0.8) {
                    console.log(`[NZBDAV:history] NZB ${nzoId} status: ${status}.`);
                }
            } else {
                console.debug(`[NZBDAV:history] Job ${nzoId} not found in history yet.`);
            }

        } catch (err) {
            if (err instanceof NzbdavError) throw err;
            if ((err as Error).name === "AbortError") throw err;
            console.warn(`[NZBDAV] Poll warning: ${err instanceof Error ? err.message : err}`);
        }

        await sleep(currentInterval, signal);

        if (currentInterval < MAX_INTERVAL) {
            currentInterval = Math.floor(currentInterval * 1.5);
        }
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

    // OPTIMIZATION: Calculate Hash Once
    const urlHash = md5(downloadUrl);
    const cacheKey = `streams:${urlHash}`;

    // 1. Determine correct Job Name logic
    const isAltMount = Config.NZBDAV_URL.includes("altmount");
    const intendedJobName = isAltMount ? urlHash : title;

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
        const typeLabel = Config.USE_STRM_FILES ? "STRM" : isAltMount ? "AltMount" : "NZBDAV";
        console.log(`[${typeLabel}] Pre-cache hit: ${existingFile.viewPath}`);

        const result: StreamResult = {
            viewPath: existingFile.viewPath,
            fileName: existingFile.viewPath.split("/").pop() ?? "video.mkv",
            inFileSystem: !Config.USE_STRM_FILES,
            category,
            jobName: intendedJobName
        };

        setJsonValue(cacheKey, "$.viewPath", existingFile.viewPath).catch(console.error);

        return result;
    }

    // 4. Proxy Download (Add to NZBDav) 
    const proxyUrl = `${Config.ADDON_BASE_URL}/nzb/proxy/${urlHash}.nzb`;
    const { nzoId } = await addNzbToNzbdav(proxyUrl, category, intendedJobName);

    // 5. Wait for completion
    const slot = await waitForNzbdavHistorySlot(nzoId, category, signal);

    // --- SANITIZATION & SEARCH ---
    let searchName = slot.jobName || slot.name || intendedJobName;

    // Fast Cleanup
    if (searchName.endsWith(".nzb")) searchName = searchName.slice(0, -4);

    // Handle path separators in job names
    if (searchName.indexOf("/") !== -1 || searchName.indexOf("\\") !== -1) {
        console.warn(`[NZBDAV] Job name contained path characters: "${searchName}". Sanitizing.`);
        searchName = searchName.split(/[/\\]/).pop() || searchName;
    }

    if (isAltMount && intendedJobName && searchName !== intendedJobName) {
        console.log(`[NZBDAV] Enforcing AltMount hash for search: ${intendedJobName}`);
        searchName = intendedJobName;
    }

    if (!searchName) throw new Error("[NZBDAV] No job name available for file search");

    // 6. Find final file path
    const bestFile = await findBestVideoFile({
        category: slot.category || category,
        jobName: searchName,
        requestedEpisode,
    });

    if (!bestFile) {
        console.error(`[NZBDAV] Search failed for: Category=${slot.category}, Job=${searchName}`);
        throw new Error("[NZBDAV] Download complete but no video file found");
    }

    const result: StreamResult = {
        nzoId,
        category: slot.category || category,
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

    Promise.all([
        setJsonValue(cacheKey, "$", result),
        (indexer && fileId)
            ? updateNzbStatus({ source_indexer: indexer, file_id: fileId }, true, "Ready to stream")
            : Promise.resolve()
    ]).catch(err => console.error("[NZBDAV] Background update error:", err));

    console.log(`[NZBDAV] Stream ready: ${result.viewPath}`);
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
        return (await streamFailureVideo(req)) || new Response(JSON.stringify({ error: "Stream metadata missing or expired" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
        });
    }

    const { downloadUrl, type = "movie", title = "NZB Stream", prowlarrId, guid, indexer } = meta;
    const id = meta.rawImdbId ?? "";
    const lockKey = `stream_build:${md5(downloadUrl)}`;

    try {
        const category = getNzbdavCategory(type);
        const episode = parseRequestedEpisode(type, id);

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

            const bgTasks = [];
            bgTasks.push(redis.del(redisKey));

            if (prowlarrId && downloadUrl) {
                const searchKey = `prowlarr:search:${id}`;
                bgTasks.push(removeFailedProwlarrEntry(searchKey, downloadUrl));
            }

            if (indexer && guid) {
                bgTasks.push(updateNzbStatus({ source_indexer: indexer, file_id: guid }, false, err.failureMessage || msg));
            }

            Promise.all(bgTasks).catch(e => console.error("Cleanup error", e));

            return (await streamFailureVideo(req, err)) || new Response(JSON.stringify({ error: msg }), { status: 502 });
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