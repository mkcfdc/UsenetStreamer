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

const POLLING = {
    INITIAL_WAIT: 50,
    MAX_WAIT: 1000,
    LOCK_TIMEOUT: 45_000,
    PARTIAL_FILE_TIMEOUT: 20_000,
};

// --- Logging Helpers ---

const now = () => performance.now();
const dur = (start: number) => (performance.now() - start).toFixed(0);

function log(scope: string, msg: string, ...args: any[]) {
    const ts = new Date().toISOString().split("T")[1].slice(0, -1);
    console.log(`[${ts}] [${scope}] ${msg}`, ...args);
}

function error(scope: string, msg: string, err?: any) {
    const ts = new Date().toISOString().split("T")[1].slice(0, -1);
    console.error(`[${ts}] [${scope}] ERROR: ${msg}`, err instanceof Error ? err.message : err);
}

// --- Errors ---

class NzbdavError extends Error {
    isNzbdavFailure = true;
    constructor(
        message: string,
        public failureMessage: string,
        public nzoId?: string,
        public category?: string,
    ) {
        super(message);
    }
}

// --- Caches ---

const nzbdavStreamCache = new LRU<string, Promise<StreamResult> | StreamResult>(CACHE_CONFIG.NZBDAV);
const streamMetadataCache = new LRU<string, StreamCache>(CACHE_CONFIG.META);

const scriptShas: Record<string, string> = {};

redis.on("ready", async () => {
    try {
        const r = redis as any;
        const [lock, fail, prowlarr] = await Promise.all([
            r.script("LOAD", ACQUIRE_LOCK_SCRIPT),
            r.script("LOAD", FAST_FAIL_SCRIPT),
            r.script("LOAD", REMOVE_PROWLARR_SCRIPT),
        ]);
        scriptShas.acquireLock = lock;
        scriptShas.fastFail = fail;
        scriptShas.removeProwlarr = prowlarr;
        log("Redis", "Lua scripts loaded");
    } catch (err) {
        console.warn("[Redis] Script preload failed (will fallback lazily):", err);
    }
});

// --- Redis Helpers ---

async function runScript(name: keyof typeof scriptShas, script: string, numKeys: number, ...args: any[]): Promise<any> {
    const r = redis as any;
    const sha = scriptShas[name];
    if (sha) {
        try {
            return await r.evalsha(sha, numKeys, ...args);
        } catch (e: any) {
            if (!e?.message?.includes("NOSCRIPT")) throw e;
        }
    }
    const newSha = await r.script("LOAD", script);
    scriptShas[name] = newSha;
    return r.evalsha(newSha, numKeys, ...args);
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

async function getFastFailStatus(key: string) {
    // Returns [status, failureMessage, nzoId, viewPath, fileName]
    try {
        const res = await runScript("fastFail", FAST_FAIL_SCRIPT, 1, key);
        if (!Array.isArray(res) || res.length === 0) return null;
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

// --- API & Utilities ---

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

// --- Core Logic ---

async function addNzbToNzbdav(nzbUrl: string, category: string, jobName: string) {
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

async function monitorNzbdavJob(nzoId: string, category: string, cacheKey: string) {
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
                    log("Monitor", `Job ${nzoId} completed successfully`);
                    return setJsonValue(cacheKey, "$.status", "ready").catch(() => { });
                }
                if (status === "failed" || status === "error") {
                    const failMsg = raw.fail_message || raw.failMessage || "Unknown error";
                    throw new NzbdavError(`Job failed: ${failMsg}`, failMsg, nzoId, category);
                }
            }
            await sleep(interval);
            interval = Math.min(interval * 1.5, 8000);
        }
        log("Monitor", `Job ${nzoId} timed out in monitor`);
    } catch (err: any) {
        error("Monitor", `Failed for ${nzoId}`, err);

        try {
            const pipeline = redis.pipeline();
            pipeline.call("JSON.SET", cacheKey, "$.status", JSON.stringify("failed"));
            pipeline.call("JSON.SET", cacheKey, "$.failureMessage", JSON.stringify(err.failureMessage || err.message));
            if (err.nzoId) pipeline.call("JSON.SET", cacheKey, "$.nzoId", JSON.stringify(err.nzoId));

            const results = await pipeline.exec();
            if (results?.some((res: any) => res[0] !== null)) {
                error("Monitor", `Redis update failed for ${cacheKey}`, results);
            } else {
                log("Monitor", `Marked ${cacheKey} as failed in Redis`);
            }
        } catch (e) {
            error("Monitor", `CRITICAL: Failed to write error state to Redis`, e);
        }
    }
}

async function waitForPartialVideoFile(
    cacheKey: string,
    category: string,
    jobName: string,
    episode?: EpisodeInfo,
    signal?: AbortSignal
) {
    const tStart = now();
    const deadline = Date.now() + POLLING.PARTIAL_FILE_TIMEOUT;
    let interval = POLLING.INITIAL_WAIT;
    let attempt = 0;

    log("Wait", `Waiting for media file. Job: ${jobName}`);

    while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason;
        attempt++;

        // 1. Check Redis (Fast Script)
        let ff = await getFastFailStatus(cacheKey);

        if (ff?.status === "failed") {
            throw new NzbdavError(`Job failed: ${ff.failureMessage}`, ff.failureMessage || "Job failed", ff.nzoId, category);
        }
        if (ff?.viewPath) {
            log("Wait", `Found in Redis after ${dur(tStart)}ms`);
            return { viewPath: ff.viewPath, name: ff.fileName || "video.mkv" };
        }

        // 2. DOUBLE CHECK: If script didn't return 'failed', verify with direct JSON read.
        // This handles cases where the Lua script might be returning "pending" from a cache or stale logic
        // while the underlying JSON was actually updated to "failed".
        try {
            const raw = await getJsonValue<any>(cacheKey);
            if (raw?.status === "failed") {
                throw new NzbdavError(
                    `Job failed: ${raw.failureMessage}`,
                    raw.failureMessage || "Job failed",
                    raw.nzoId,
                    category
                );
            }
        } catch (e) {
            if (e instanceof NzbdavError) throw e;
            // Ignore read errors
        }

        // 3. Check Filesystem (Can be slow)
        const file = await findBestVideoFile({
            category,
            jobName,
            requestedEpisode: episode,
            allowPartial: true
        } as any);

        if (file?.viewPath) {
            log("Wait", `Found on FS after ${dur(tStart)}ms (attempt ${attempt})`);
            return { viewPath: file.viewPath, name: file.name };
        }

        if (attempt === 10 || attempt % 20 === 0) {
            log("Wait", `Still waiting... ${dur(tStart)}ms elapsed. Status: ${ff?.status || 'null'}`);
        }

        await sleep(interval, signal);
        if (interval < POLLING.MAX_WAIT) interval *= 1.5;
    }
    throw new Error(`[NZBDAV] Timed out waiting for media file after ${dur(tStart)}ms`);
}

async function buildStream(params: {
    urlHash: string,
    cacheKey: string,
    downloadUrl: string,
    category: string,
    title: string,
    episode?: EpisodeInfo,
    indexer?: string,
    fileId?: string,
    signal?: AbortSignal
}): Promise<StreamResult> {
    const { urlHash, cacheKey, downloadUrl, category, title, episode, indexer, fileId, signal } = params;
    const t0 = now();
    const scope = `Build:${urlHash.substring(0, 6)}`;
    log(scope, `Building stream: ${title}`);

    const isAlt = Config.NZBDAV_URL.includes("altmount");
    const jobName = isAlt ? urlHash : title;

    // 1. Check existing file first
    const existing = await findBestVideoFile({ category, jobName, requestedEpisode: episode });
    if (existing?.viewPath) {
        log(scope, `Pre-check found existing file. Took ${dur(t0)}ms`);
        const result: StreamResult = {
            viewPath: existing.viewPath,
            fileName: existing.viewPath.split("/").pop() ?? "video.mkv",
            inFileSystem: !Config.USE_STRM_FILES,
            category,
            jobName,
            status: "ready"
        };
        setJsonValue(cacheKey, "$", result).catch(() => { });
        return result;
    }

    // 2. Add to Downloader
    const proxyUrl = `${Config.ADDON_BASE_URL}/nzb/proxy/${urlHash}.nzb`;
    const nzoId = await addNzbToNzbdav(proxyUrl, category, jobName);

    // 3. Initialize Cache State
    try {
        await setJsonValue(cacheKey, "$", {
            status: "pending",
            nzoId,
            category,
            jobName,
            title,
            downloadUrl,
        });
    } catch (e: any) {
        error(scope, `Failed to initialize Redis key`, e);
    }

    // 4. Start Background Monitor
    monitorNzbdavJob(nzoId, category, cacheKey);

    // 5. Wait for file appearance
    const partial = await waitForPartialVideoFile(cacheKey, category, jobName, episode, signal);

    log(scope, `Stream ready. Total build time: ${dur(t0)}ms`);

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

// --- Main Handler ---

export async function streamNzbdavProxy(keyHash: string, req: Request): Promise<Response> {
    const tTotal = now();
    const scope = `Req:${keyHash.substring(0, 6)}`;
    const redisKey = `streams:${keyHash}`;

    // 1. Fetch Metadata
    let meta = streamMetadataCache.get(redisKey);
    if (!meta) {
        meta = await getJsonValue<StreamCache>(redisKey);
        if (!meta) {
            log(scope, `Stream metadata expired/missing`);
            const failure = await streamFailureVideo(req);
            return failure || new Response(JSON.stringify({ error: "Stream expired" }), { status: 502 });
        }
        streamMetadataCache.set(redisKey, meta);
    }

    const { downloadUrl, type = "movie", title = "NZB Stream", prowlarrId, guid, indexer, rawImdbId: id } = meta;
    const urlHash = md5(downloadUrl);
    const streamCacheKey = `streams:${urlHash}`;
    const lockKey = `lock:stream:${urlHash}`;
    const category = getNzbdavCategory(type);

    try {
        // 2. Memory Cache Check
        const memCached = nzbdavStreamCache.get(streamCacheKey);
        if (memCached) {
            if ('then' in memCached) {
                log(scope, `Joining existing build...`);
                const data = await memCached;
                nzbdavStreamCache.set(streamCacheKey, data);
                return await proxyNzbdavStream(req, data.viewPath, data.fileName || "video.mkv", data.inFileSystem);
            } else {
                log(scope, `Memory cache hit! Serving stream. ${dur(tTotal)}ms`);
                return await proxyNzbdavStream(req, memCached.viewPath, memCached.fileName || "video.mkv", memCached.inFileSystem);
            }
        }

        // 3. Redis Check (Fast Path + Fallback)
        const tRedis = now();
        let fastFail = await getFastFailStatus(streamCacheKey);

        if (!fastFail) {
            try {
                const raw = await getJsonValue<any>(streamCacheKey);
                if (raw) {
                    fastFail = {
                        status: raw.status,
                        failureMessage: raw.failureMessage,
                        nzoId: raw.nzoId,
                        viewPath: raw.viewPath,
                        fileName: raw.fileName
                    };
                }
            } catch { }
        }

        if (fastFail?.status === "failed") {
            throw new NzbdavError("Job failed previously", fastFail.failureMessage || "Failed", fastFail.nzoId, category);
        }
        if (fastFail?.viewPath) {
            nzbdavStreamCache.set(streamCacheKey, {
                viewPath: fastFail.viewPath,
                fileName: fastFail.fileName,
                status: "ready",
                category,
                jobName: title,
                inFileSystem: true
            });
            log(scope, `Redis hit! Serving stream. (${dur(tRedis)}ms check, ${dur(tTotal)}ms total)`);
            return await proxyNzbdavStream(req, fastFail.viewPath, fastFail.fileName || "video.mkv", true);
        }

        // 4. Build Stream
        log(scope, `No stream ready. Acquiring lock...`);
        const tLock = now();

        if (!await acquireLock(lockKey, POLLING.LOCK_TIMEOUT)) {
            log(scope, `Lock contention. Entering wait loop...`);
            const deadline = Date.now() + 15_000;
            let interval = 100;

            while (Date.now() < deadline) {
                if (req.signal?.aborted) throw req.signal.reason;

                // Check Redis with fallback logic
                let check = await getFastFailStatus(streamCacheKey);
                if (!check) {
                    try {
                        const raw = await getJsonValue<any>(streamCacheKey);
                        if (raw) check = { status: raw.status, failureMessage: raw.failureMessage, nzoId: raw.nzoId, viewPath: raw.viewPath, fileName: raw.fileName };
                    } catch { }
                }

                if (check?.status === "failed") throw new NzbdavError("Job failed", check.failureMessage!, check.nzoId, category);
                if (check?.viewPath) {
                    log(scope, `Stream became ready during wait. Total: ${dur(tTotal)}ms`);
                    return await proxyNzbdavStream(req, check.viewPath, check.fileName || "video.mkv", true);
                }

                const localCheck = nzbdavStreamCache.get(streamCacheKey);
                if (localCheck && !('then' in localCheck)) {
                    return await proxyNzbdavStream(req, localCheck.viewPath, localCheck.fileName || "video.mkv", localCheck.inFileSystem);
                }

                await sleep(interval, req.signal);
                interval = Math.min(interval * 1.5, 500);
            }
            throw new Error("Timeout waiting for stream lock/build");
        }

        log(scope, `Lock acquired in ${dur(tLock)}ms.`);

        try {
            let streamPromise = nzbdavStreamCache.get(streamCacheKey);

            if (!streamPromise) {
                log(scope, `Initiating new build...`);
                streamPromise = buildStream({
                    urlHash, cacheKey: streamCacheKey, downloadUrl,
                    category, title, episode: parseRequestedEpisode(type, id ?? ""),
                    indexer, fileId: guid, signal: req.signal
                });
                nzbdavStreamCache.set(streamCacheKey, streamPromise);
            } else {
                log(scope, `Attaching to existing build promise found inside lock`);
            }

            if ('then' in streamPromise) {
                const data = await streamPromise;
                nzbdavStreamCache.set(streamCacheKey, data);
                log(scope, `Build complete. Serving stream. Total time: ${dur(tTotal)}ms`);
                return await proxyNzbdavStream(req, data.viewPath, data.fileName || "video.mkv", data.inFileSystem);
            } else {
                const data = streamPromise as StreamResult;
                log(scope, `Data found inside lock. Serving. Total time: ${dur(tTotal)}ms`);
                return await proxyNzbdavStream(req, data.viewPath, data.fileName || "video.mkv", data.inFileSystem);
            }

        } finally {
            releaseLock(lockKey);
        }

    } catch (err: any) {
        error(scope, `Stream Error`, err);

        // Cleanup Logic
        if (err.isNzbdavFailure || err.message.includes("failed")) {
            const pipeline = redis.pipeline();
            pipeline.del(redisKey);

            if (prowlarrId && downloadUrl) {
                const sKey = `search:${id}`;
                if (scriptShas.removeProwlarr) pipeline.evalsha(scriptShas.removeProwlarr, 1, sKey, downloadUrl);
                else pipeline.eval(REMOVE_PROWLARR_SCRIPT, 1, sKey, downloadUrl);
            }

            Promise.all([
                pipeline.exec(),
                indexer && guid ? updateNzbStatus({ source_indexer: indexer, file_id: guid }, false, err.failureMessage || err.message) : null
            ]).catch(e => console.warn("Cleanup error:", e));
        }

        const failureVid = await streamFailureVideo(req, err);
        if (failureVid) return failureVid;

        return new Response(JSON.stringify({ error: err.failureMessage || err.message }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
        });
    }
}
