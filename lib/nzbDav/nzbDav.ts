// deno-lint-ignore-file no-explicit-any
import { LRUCache as LRU } from "lru-cache";
import { getJsonValue, redis, setJsonValue } from "../../utils/redis.ts";
import { md5 } from "../../utils/md5Encoder.ts";
import { findBestVideoFile } from "../../utils/findBestVideoFile.ts";
import { streamFailureVideo } from "../streamFailureVideo.ts";
import {
    parseRequestedEpisode,
    type EpisodeInfo,
} from "../../utils/parseRequestedEpisode.ts";
import { proxyNzbdavStream } from "./proxyNzbdav.ts";
import { buildNzbdavApiParams, getNzbdavCategory, sleep } from "./nzbUtils.ts";
import { updateNzbStatus } from "../nzbcheck.ts";
import { fetcher } from "../../utils/fetcher.ts";
import { Config } from "../../env.ts";
import {
    ACQUIRE_LOCK_SCRIPT,
    FAST_FAIL_SCRIPT,
    REMOVE_PROWLARR_SCRIPT,
} from "../redisScripts.ts";
import type { StreamCache, StreamResult } from "./types.ts";

// --- Configuration & Constants ---

const CACHE_CONFIG = {
    NZBDAV: { max: Config.NZBDAV_CACHE_MAX_ITEMS, ttl: Config.NZBDAV_CACHE_TTL_MS },
    META: { max: Config.STREAM_METADATA_CACHE_MAX_ITEMS, ttl: Config.STREAM_METADATA_CACHE_TTL_MS },
};

const FAILURE_TTL_SECONDS = 300;

const POLLING = {
    INITIAL_WAIT: 50,
    MAX_WAIT: 1000,
    LOCK_TIMEOUT: 45_000,
    PARTIAL_FILE_TIMEOUT: 20_000,
    DISTRIBUTED_TIMEOUT: 15_000,
};

// --- Logging ---

const now = performance.now.bind(performance);
const dur = (start: number) => (performance.now() - start).toFixed(0);
const timestamp = () => new Date().toISOString().slice(11, -1);

const log = (scope: string, msg: string, ...args: any[]) =>
    console.log(`[${timestamp()}] [${scope}] ${msg}`, ...args);

const error = (scope: string, msg: string, err?: any) =>
    console.error(`[${timestamp()}] [${scope}] ERROR: ${msg}`, err instanceof Error ? err.message : err);

// --- Errors ---

class NzbdavError extends Error {
    readonly isNzbdavFailure = true;
    constructor(
        message: string,
        public readonly failureMessage: string,
        public readonly nzoId?: string,
        public readonly category?: string,
    ) {
        super(message);
    }
}

// --- Caches ---

const nzbdavStreamCache = new LRU<string, Promise<StreamResult> | StreamResult>(CACHE_CONFIG.NZBDAV);
const streamMetadataCache = new LRU<string, StreamCache>(CACHE_CONFIG.META);
const scriptShas: Record<string, string> = {};

const isPromise = <T>(v: T | Promise<T>): v is Promise<T> =>
    v !== null && typeof v === "object" && typeof (v as any).then === "function";

redis.on("ready", async () => {
    try {
        const [lock, fail, prowlarr] = await Promise.all([
            (redis as any).script("LOAD", ACQUIRE_LOCK_SCRIPT),
            (redis as any).script("LOAD", FAST_FAIL_SCRIPT),
            (redis as any).script("LOAD", REMOVE_PROWLARR_SCRIPT),
        ]);
        Object.assign(scriptShas, { acquireLock: lock, fastFail: fail, removeProwlarr: prowlarr });
        log("Redis", "Lua scripts loaded");
    } catch (err) {
        console.warn("[Redis] Script preload failed:", err);
    }
});

// --- Redis Helpers ---

async function runScript(name: string, script: string, numKeys: number, ...args: any[]): Promise<any> {
    const r = redis as any;
    let sha = scriptShas[name];

    if (sha) {
        try {
            return await r.evalsha(sha, numKeys, ...args);
        } catch (e: any) {
            if (!e?.message?.includes("NOSCRIPT")) throw e;
        }
    }

    sha = scriptShas[name] = await r.script("LOAD", script);
    return r.evalsha(sha, numKeys, ...args);
}

async function acquireLock(key: string, ttl: number): Promise<boolean> {
    const val = Date.now().toString();
    try {
        const res = await runScript("acquireLock", ACQUIRE_LOCK_SCRIPT, 1, key, val, ttl);
        return res[0] === 1;
    } catch {
        return (await (redis as any).set(key, val, "PX", ttl, "NX")) === "OK";
    }
}

const releaseLock = (key: string) => redis.del(key).catch(() => { });

interface FastFailResult {
    status?: string;
    failureMessage?: string;
    nzoId?: string;
    viewPath?: string;
    fileName?: string;
}

async function getFastFailStatus(key: string): Promise<FastFailResult | null> {
    try {
        const res = await runScript("fastFail", FAST_FAIL_SCRIPT, 1, key);
        if (!Array.isArray(res) || !res.length) return null;
        return {
            status: res[0] || undefined,
            failureMessage: res[1] || undefined,
            nzoId: res[2] || undefined,
            viewPath: res[3] || undefined,
            fileName: res[4] || undefined,
        };
    } catch {
        return null;
    }
}

async function getStreamStatus(cacheKey: string): Promise<FastFailResult | null> {
    const ff = await getFastFailStatus(cacheKey);
    if (ff?.status === "failed" || ff?.viewPath) return ff;

    try {
        const raw = await getJsonValue<any>(cacheKey);
        if (!raw) return ff;
        return {
            status: raw.status,
            failureMessage: raw.failureMessage,
            nzoId: raw.nzoId,
            viewPath: raw.viewPath,
            fileName: raw.fileName,
        };
    } catch {
        return ff;
    }
}

// --- API ---

export async function fetchNzbdav<T = any>(
    mode: string,
    params: Record<string, any> = {},
    timeoutMs = Config.NZBDAV_API_TIMEOUT_MS ?? 10000,
): Promise<T> {
    const start = now();
    const cleanParams: Record<string, string | number | boolean> = {};
    for (const k in params) {
        if (params[k] !== undefined) cleanParams[k] = params[k];
    }

    try {
        const data = await fetcher<any>(`${Config.NZBDAV_URL}/api`, {
            params: buildNzbdavApiParams(mode, cleanParams),
            timeoutMs,
            headers: { "X-API-KEY": Config.NZBDAV_API_KEY || "" },
        });
        if (data?.error) throw new Error(`[NZBDAV] API Error: ${data.error}`);
        return data as T;
    } catch (e) {
        error("API", `Cmd: ${mode} failed after ${dur(start)}ms`, e);
        throw e;
    }
}

// --- Polling Helper ---

async function poll<T>(
    fn: () => Promise<T | undefined>,
    opts: { timeout: number; initialWait?: number; maxWait?: number; signal?: AbortSignal }
): Promise<T> {
    const { timeout, initialWait = POLLING.INITIAL_WAIT, maxWait = POLLING.MAX_WAIT, signal } = opts;
    const deadline = Date.now() + timeout;
    let interval = initialWait;

    while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason;
        const result = await fn();
        if (result !== undefined) return result;
        await sleep(interval, signal);
        interval = Math.min(interval * 1.5, maxWait);
    }
    throw new Error(`Poll timeout after ${timeout}ms`);
}

// --- Core Logic ---

async function addNzbToNzbdav(nzbUrl: string, category: string, jobName: string): Promise<string> {
    if (!nzbUrl) throw new Error("Missing NZB URL");
    const t0 = now();
    log("NZB", `Adding URL to category: ${category}`);

    const json = await fetchNzbdav<any>("addurl", { name: nzbUrl, cat: category, nzbname: jobName });
    const nzoId = json?.nzo_ids?.[0] || json?.nzoId || json?.nzo_id;

    if (!nzoId) {
        log("NZB", `Add fail dump: ${JSON.stringify(json)}`);
        throw new Error("[NZBDAV] Failed to queue NZB");
    }
    log("NZB", `NZB Added. ID: ${nzoId}. Took ${dur(t0)}ms`);
    return nzoId;
}

async function monitorNzbdavJob(nzoId: string, category: string, cacheKey: string): Promise<void> {
    const deadline = Date.now() + Config.NZBDAV_POLL_TIMEOUT_MS;
    let interval = 700;
    log("Monitor", `Starting bg monitor for ${nzoId}`);

    try {
        while (Date.now() < deadline) {
            const json = await fetchNzbdav<any>("history", { start: "0", limit: "10", nzo_ids: nzoId, category });
            const slots = json?.history?.slots ?? json?.slots ?? [];
            const raw = slots.find((s: any) => (s?.nzo_id || s?.id) === nzoId) ?? slots[0];

            if (raw) {
                const status = (raw.status || "").toLowerCase();
                if (status === "completed" || status === "success") {
                    log("Monitor", `Job ${nzoId} completed`);
                    await setJsonValue(cacheKey, "$.status", "ready").catch(() => { });
                    return;
                }
                if (status === "failed" || status === "error") {
                    throw new NzbdavError(
                        `Job failed: ${raw.fail_message || raw.failMessage || "Unknown"}`,
                        raw.fail_message || raw.failMessage || "Unknown error",
                        nzoId,
                        category
                    );
                }
            }
            await sleep(interval);
            interval = Math.min(interval * 1.5, 8000);
        }
        log("Monitor", `Job ${nzoId} timed out`);
    } catch (err: any) {
        error("Monitor", `Failed for ${nzoId}`, err);
        try {
            await redis.pipeline()
                .call("JSON.SET", cacheKey, "$.status", JSON.stringify("failed"))
                .call("JSON.SET", cacheKey, "$.failureMessage", JSON.stringify(err.failureMessage || err.message))
                .call("JSON.SET", cacheKey, "$.nzoId", JSON.stringify(err.nzoId || nzoId))
                .exec();
            log("Monitor", `Marked ${cacheKey} as failed`);
        } catch (e) {
            error("Monitor", `Failed to write error state`, e);
        }
    }
}

async function waitForPartialVideoFile(
    cacheKey: string,
    category: string,
    jobName: string,
    episode?: EpisodeInfo,
    signal?: AbortSignal
): Promise<{ viewPath: string; name: string }> {
    const tStart = now();
    log("Wait", `Waiting for media file. Job: ${jobName}`);

    const result = await poll(async () => {
        const status = await getStreamStatus(cacheKey);

        if (status?.status === "failed") {
            throw new NzbdavError(`Job failed: ${status.failureMessage}`, status.failureMessage || "Job failed", status.nzoId, category);
        }
        if (status?.viewPath) {
            log("Wait", `Found in Redis after ${dur(tStart)}ms`);
            return { viewPath: status.viewPath, name: status.fileName || "video.mkv" };
        }

        const file = await findBestVideoFile({ category, jobName, requestedEpisode: episode, allowPartial: true } as any);
        if (file?.viewPath) {
            log("Wait", `Found on FS after ${dur(tStart)}ms`);
            return { viewPath: file.viewPath, name: file.name };
        }
    }, { timeout: POLLING.PARTIAL_FILE_TIMEOUT, signal });

    return result;
}

interface BuildParams {
    urlHash: string;
    cacheKey: string;
    downloadUrl: string;
    category: string;
    title: string;
    jobName: string;
    episode?: EpisodeInfo;
    indexer?: string;
    fileId?: string;
    signal?: AbortSignal;
}

async function buildStream(params: BuildParams): Promise<StreamResult> {
    const { urlHash, cacheKey, downloadUrl, category, title, jobName, episode, indexer, fileId, signal } = params;
    const t0 = now();
    const scope = `Build:${urlHash.slice(0, 6)}`;
    log(scope, `Building stream: ${title}`);

    const proxyUrl = `${Config.ADDON_BASE_URL}/nzb/proxy/${urlHash}.nzb`;
    const nzoId = await addNzbToNzbdav(proxyUrl, category, jobName);

    setJsonValue(cacheKey, "$", { status: "pending", nzoId, category, jobName, title, downloadUrl }).catch(() => { });

    monitorNzbdavJob(nzoId, category, cacheKey);

    const partial = await waitForPartialVideoFile(cacheKey, category, jobName, episode, signal);

    log(scope, `Stream ready. Build time: ${dur(t0)}ms`);

    const result: StreamResult = {
        nzoId,
        category,
        jobName,
        viewPath: partial.viewPath,
        fileName: partial.name,
        downloadUrl,
        guid: fileId,
        indexer,
        title,
        inFileSystem: true,
        status: "ready"
    };

    setJsonValue(cacheKey, "$", result).catch(() => { });
    return result;
}

async function waitForDistributedStream(
    streamCacheKey: string,
    category: string,
    signal?: AbortSignal
): Promise<StreamResult> {
    const start = now();
    log("Wait", `Distributed wait for ${streamCacheKey}`);

    const result = await poll(async () => {
        const status = await getStreamStatus(streamCacheKey);

        if (status?.status === "failed") {
            throw new NzbdavError("Job failed (detected in wait)", status.failureMessage!, status.nzoId, category);
        }
        if (status?.viewPath) {
            log("Wait", `Stream ready after ${dur(start)}ms`);
            return {
                viewPath: status.viewPath,
                fileName: status.fileName || "video.mkv",
                status: "ready" as const,
                category,
                jobName: "Waited Stream",
                inFileSystem: true
            };
        }
    }, { timeout: POLLING.DISTRIBUTED_TIMEOUT, initialWait: 100, maxWait: 500, signal });

    return result;
}

// --- Main Handler ---

export async function streamNzbdavProxy(keyHash: string, req: Request): Promise<Response> {
    const tTotal = now();
    const scope = `Req:${keyHash.slice(0, 6)}`;
    const redisKey = `streams:${keyHash}`;

    let meta = streamMetadataCache.get(redisKey);
    if (!meta) {
        meta = await getJsonValue<StreamCache>(redisKey);
        if (!meta) {
            log(scope, `Stream metadata expired/missing`);
            return await streamFailureVideo(req) || new Response(JSON.stringify({ error: "Stream expired" }), { status: 502 });
        }
        streamMetadataCache.set(redisKey, meta);
    }

    const { downloadUrl, type = "movie", title = "NZB Stream", prowlarrId, guid, indexer, rawImdbId: id } = meta;
    const urlHash = md5(downloadUrl);
    const streamCacheKey = `streams:${urlHash}`;
    const failedKey = `failed:${urlHash}`;
    const lockKey = `lock:stream:${urlHash}`;
    const category = getNzbdavCategory(type);
    const isAlt = Config.NZBDAV_URL.includes("altmount");
    const jobName = isAlt ? urlHash : title;
    const episode = parseRequestedEpisode(type, id ?? "");

    try {
        // Check for known failure FIRST (fast path)
        const knownFailure = await redis.get(failedKey);
        if (knownFailure) {
            log(scope, `Known failure, fast-failing`);
            throw new NzbdavError("Job failed previously", knownFailure as string, undefined, category);
        }

        let cachedItem = nzbdavStreamCache.get(streamCacheKey);

        if (cachedItem) {
            if (isPromise(cachedItem)) {
                log(scope, `Joining in-flight build...`);
                cachedItem = await cachedItem;
            }
            log(scope, `Memory hit! Total: ${dur(tTotal)}ms`);
            return await proxyNzbdavStream(req, cachedItem.viewPath, cachedItem.fileName || "video.mkv", cachedItem.inFileSystem);
        }

        const fastFail = await getFastFailStatus(streamCacheKey);

        if (fastFail?.status === "failed") {
            throw new NzbdavError("Job failed previously", fastFail.failureMessage || "Failed", fastFail.nzoId, category);
        }

        if (fastFail?.viewPath) {
            const result: StreamResult = {
                viewPath: fastFail.viewPath,
                fileName: fastFail.fileName || "video.mkv",
                status: "ready",
                category,
                jobName,
                inFileSystem: true
            };
            nzbdavStreamCache.set(streamCacheKey, result);
            log(scope, `Redis hit! Total: ${dur(tTotal)}ms`);
            return await proxyNzbdavStream(req, result.viewPath, result.fileName, true);
        }

        const streamPromise = (async (): Promise<StreamResult> => {
            const hasLock = await acquireLock(lockKey, POLLING.LOCK_TIMEOUT);

            if (!hasLock) {
                log(scope, `Lock busy, waiting...`);
                return waitForDistributedStream(streamCacheKey, category, req.signal);
            }

            const tLock = now();
            log(scope, `Lock acquired. Building...`);
            try {
                // Re-check failure after acquiring lock (another request may have failed)
                const recheck = await redis.get(failedKey);
                if (recheck) {
                    throw new NzbdavError("Job failed", recheck as string, undefined, category);
                }

                const existing = await findBestVideoFile({ category, jobName, requestedEpisode: episode });
                if (existing?.viewPath) {
                    const result: StreamResult = {
                        viewPath: existing.viewPath,
                        fileName: existing.name,
                        status: "ready",
                        category,
                        jobName,
                        inFileSystem: !Config.USE_STRM_FILES
                    };
                    setJsonValue(streamCacheKey, "$", result).catch(() => { });
                    return result;
                }

                return await buildStream({
                    urlHash,
                    cacheKey: streamCacheKey,
                    downloadUrl,
                    category,
                    title,
                    jobName,
                    episode,
                    indexer,
                    fileId: guid,
                    signal: req.signal
                });
            } finally {
                releaseLock(lockKey);
                log(scope, `Lock released. Build: ${dur(tLock)}ms`);
            }
        })();

        nzbdavStreamCache.set(streamCacheKey, streamPromise);

        try {
            const result = await streamPromise;
            nzbdavStreamCache.set(streamCacheKey, result);
            log(scope, `Ready. Total: ${dur(tTotal)}ms`);
            return await proxyNzbdavStream(req, result.viewPath, result.fileName || "video.mkv", result.inFileSystem);
        } catch (err) {
            nzbdavStreamCache.delete(streamCacheKey);
            throw err;
        }

    } catch (err: any) {
        error(scope, `Stream Error`, err);

        if (err.isNzbdavFailure || err.message?.includes("failed")) {
            // Set failure flag with TTL — this survives the metadata delete
            redis.setex(failedKey, FAILURE_TTL_SECONDS, err.failureMessage || err.message).catch(() => { });

            const pipeline = redis.pipeline();
            pipeline.del(redisKey);

            if (prowlarrId && downloadUrl) {
                const sKey = `search:${id}`;
                scriptShas.removeProwlarr
                    ? pipeline.evalsha(scriptShas.removeProwlarr, 1, sKey, downloadUrl)
                    : pipeline.eval(REMOVE_PROWLARR_SCRIPT, 1, sKey, downloadUrl);
            }

            pipeline.exec().catch(() => { });

            if (indexer && guid) {
                updateNzbStatus({ source_indexer: indexer, file_id: guid }, false, err.failureMessage || err.message).catch(() => { });
            }
        }

        return await streamFailureVideo(req, err) || new Response(JSON.stringify({ error: err.failureMessage || err.message }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
        });
    }
}