// deno-lint-ignore-file no-explicit-any
import { LRUCache as LRU } from "lru-cache";
import {
    acquireLock,
    getJsonValue,
    getRedis,
    getStreamStatus,
    mergeJson,
    releaseLock,
    removeSearchHit,
} from "../../utils/redis.ts";
import { FAILED_STREAM_TTL_SEC, keys, STREAM_TTL_SEC } from "../../utils/cacheKeys.ts";
import { md5 } from "../../utils/md5Encoder.ts";
import { streamFailureVideo } from "../streamFailureVideo.ts";
import { parseRequestedEpisode } from "../../utils/parseRequestedEpisode.ts";
import { proxyNzbdavStream } from "./proxyNzbdav.ts";
import { buildNzbdavApiParams, getNzbdavCategory, nzbDavAddUrl } from "./nzbUtils.ts";
import { updateNzbStatus } from "../nzbcheck.ts";
import { fetcher } from "../../utils/fetcher.ts";
import { Config } from "../../env.ts";
import { invalidateSearchCache } from "../../utils/getMediaAndSearchResults.ts";
import { addNzbToNzbdav, NzbdavError } from "./nzbAdd.ts";
import {
    monitorNzbdavJob,
    resolveVideoFile,
    waitForPartialVideoFile,
    writeStreamState,
} from "./nzbWait.ts";
import type { StreamCache, StreamResult } from "./types.ts";

const CACHE_CONFIG = {
    NZBDAV: { max: Config.NZBDAV_CACHE_MAX_ITEMS, ttl: Config.NZBDAV_CACHE_TTL_MS },
    META: { max: Config.STREAM_METADATA_CACHE_MAX_ITEMS, ttl: Config.STREAM_METADATA_CACHE_TTL_MS },
};

const POLLING = {
    LOCK_TIMEOUT: 45_000,
    DISTRIBUTED_TIMEOUT: 15_000,
};

const now = performance.now.bind(performance);
const dur = (start: number) => (performance.now() - start).toFixed(0);
const timestamp = () => new Date().toISOString().slice(11, -1);
const log = (scope: string, msg: string, ...args: any[]) =>
    console.log(`[${timestamp()}] [${scope}] ${msg}`, ...args);
const error = (scope: string, msg: string, err?: any) =>
    console.error(`[${timestamp()}] [${scope}] ERROR: ${msg}`, err instanceof Error ? err.message : err);

const nzbdavStreamCache = new LRU<string, Promise<StreamResult> | StreamResult>(CACHE_CONFIG.NZBDAV);
const streamMetadataCache = new LRU<string, StreamCache>(CACHE_CONFIG.META);
const isPromise = <T>(v: T | Promise<T>): v is Promise<T> =>
    v !== null && typeof v === "object" && typeof (v as any).then === "function";

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

async function buildStream(params: {
    urlHash: string;
    cacheKey: string;
    downloadUrl: string;
    category: string;
    title: string;
    jobName: string;
    episode?: ReturnType<typeof parseRequestedEpisode>;
    indexer?: string;
    fileId?: string;
    signal?: AbortSignal;
}): Promise<StreamResult> {
    const { urlHash, cacheKey, downloadUrl, category, title, jobName, episode, indexer, fileId, signal } = params;
    const t0 = now();
    const scope = `Build:${urlHash.slice(0, 6)}`;
    log(scope, `Building stream: ${title}`);
    const proxyUrl = nzbDavAddUrl(urlHash);
    log(scope, `NZB source ${proxyUrl}`);
    const nzoId = await addNzbToNzbdav(proxyUrl, category, jobName, downloadUrl);
    await writeStreamState(cacheKey, { status: "pending", nzoId, category, jobName, title, downloadUrl });
    monitorNzbdavJob(nzoId, category, cacheKey, jobName, episode ?? undefined);
    const partial = await waitForPartialVideoFile(cacheKey, category, jobName, episode ?? undefined, signal);
    log(scope, `Stream ready. Build time: ${dur(t0)}ms`);
    const result: StreamResult = {
        nzoId, category, jobName,
        viewPath: partial.viewPath, fileName: partial.name,
        downloadUrl, guid: fileId, indexer, title,
        inFileSystem: true, status: "ready",
    };
    await writeStreamState(cacheKey, { ...result }, STREAM_TTL_SEC);
    return result;
}

function toReadyResult(status: { viewPath?: string; fileName?: string }, category: string, jobName: string): StreamResult {
    return {
        viewPath: status.viewPath!,
        fileName: status.fileName || "video.mkv",
        status: "ready", category, jobName, inFileSystem: true,
    };
}

function waitForDistributedStream(streamCacheKey: string, category: string, signal?: AbortSignal): Promise<StreamResult> {
    log("Wait", `Distributed Pub/Sub wait for ${streamCacheKey}`);
    const pubsubClient = getRedis().duplicate();
    return new Promise<StreamResult>((resolve, reject) => {
        let isDone = false;
        const cleanup = () => { if (isDone) return; isDone = true; clearTimeout(timeoutId); pubsubClient.disconnect(); };
        const timeoutId = setTimeout(() => { cleanup(); reject(new Error("Distributed wait timeout")); }, POLLING.DISTRIBUTED_TIMEOUT);
        if (signal) signal.addEventListener("abort", () => { cleanup(); reject(signal.reason); }, { once: true });
        const channel = keys.streamChannel(streamCacheKey);
        pubsubClient.subscribe(channel).then(async () => {
            if (isDone) return;
            const status = await getStreamStatus(streamCacheKey);
            if (status?.status === "failed") {
                cleanup();
                return reject(new NzbdavError("Job failed (detected in wait)", status.failureMessage || "Job failed", status.nzoId, category));
            }
            if (status?.viewPath) { cleanup(); return resolve(toReadyResult(status, category, "Waited Stream")); }
        }).catch((err: any) => { cleanup(); reject(err); });
        pubsubClient.on("message", async (msgChannel: string) => {
            if (msgChannel !== channel) return;
            cleanup();
            const status = await getStreamStatus(streamCacheKey);
            if (status?.status === "failed") reject(new NzbdavError("Job failed", status.failureMessage || "Job failed", status.nzoId, category));
            else if (status?.viewPath) resolve(toReadyResult(status, category, "Waited Stream"));
            else reject(new Error("Stream build finished but no valid path found"));
        });
    });
}

export async function streamNzbdavProxy(keyHash: string, req: Request): Promise<Response> {
    const tTotal = now();
    const scope = `Req:${keyHash.slice(0, 6)}`;
    const redis = getRedis();
    const redisKey = keys.stream(keyHash);
    let meta = streamMetadataCache.get(redisKey);
    if (!meta) {
        meta = await getJsonValue<StreamCache>(redisKey);
        if (!meta) {
            log(scope, `Stream metadata expired/missing`);
            return await streamFailureVideo(req) || new Response(JSON.stringify({ error: "Stream expired" }), { status: 502 });
        }
        streamMetadataCache.set(redisKey, meta);
    }
    const { downloadUrl, type = "movie", title = "NZB Stream", guid, indexer, rawImdbId: id, searchKey } = meta;
    const urlHash = md5(downloadUrl);
    const streamCacheKey = keys.stream(urlHash);
    const failedKey = keys.streamFailed(urlHash);
    const lockKey = keys.streamLock(urlHash);
    const category = getNzbdavCategory(type);
    const jobName = Config.NZBDAV_URL.includes("altmount") ? urlHash : title;
    const episode = parseRequestedEpisode(type, id ?? "");
    try {
        let cachedItem = nzbdavStreamCache.get(streamCacheKey);
        if (cachedItem && !isPromise(cachedItem)) {
            log(scope, `Memory hit! Total: ${dur(tTotal)}ms`);
            return await proxyNzbdavStream(req, cachedItem.viewPath, cachedItem.fileName || "video.mkv", cachedItem.inFileSystem);
        }
        const [knownFailure, fastFail] = await Promise.all([redis.get(failedKey), getStreamStatus(streamCacheKey)]);
        if (knownFailure) throw new NzbdavError("Job failed previously", knownFailure as string, undefined, category);
        if (cachedItem && isPromise(cachedItem)) {
            log(scope, `Joining in-flight build...`);
            cachedItem = await cachedItem;
            return await proxyNzbdavStream(req, cachedItem.viewPath, cachedItem.fileName || "video.mkv", cachedItem.inFileSystem);
        }
        if (fastFail?.status === "failed") throw new NzbdavError("Job failed previously", fastFail.failureMessage || "Failed", fastFail.nzoId, category);
        if (fastFail?.viewPath) {
            const result = toReadyResult(fastFail, category, jobName);
            nzbdavStreamCache.set(streamCacheKey, result);
            log(scope, `Redis hit! Total: ${dur(tTotal)}ms`);
            return await proxyNzbdavStream(req, result.viewPath, result.fileName, true);
        }
        const streamPromise = (async (): Promise<StreamResult> => {
            const lockToken = crypto.randomUUID();
            const hasLock = await acquireLock(lockKey, POLLING.LOCK_TIMEOUT, lockToken);
            if (!hasLock) return waitForDistributedStream(streamCacheKey, category, req.signal);
            const tLock = now();
            log(scope, `Lock acquired. Building...`);
            try {
                const recheck = await redis.get(failedKey);
                if (recheck) throw new NzbdavError("Job failed", recheck as string, undefined, category);
                const existing = await resolveVideoFile(category, jobName, episode ?? undefined, true);
                if (existing) {
                    const result: StreamResult = { viewPath: existing.viewPath, fileName: existing.name, status: "ready", category, jobName, inFileSystem: !Config.USE_STRM_FILES };
                    mergeJson(streamCacheKey, { ...result }, STREAM_TTL_SEC).catch(() => {});
                    return result;
                }
                const pending = await getStreamStatus(streamCacheKey);
                if (pending?.nzoId && pending.status !== "failed") {
                    log(scope, `Rejoining NZBDav job ${pending.nzoId}`);
                    monitorNzbdavJob(pending.nzoId, category, streamCacheKey, jobName, episode ?? undefined);
                    const partial = await waitForPartialVideoFile(streamCacheKey, category, jobName, episode ?? undefined, req.signal);
                    const result: StreamResult = { nzoId: pending.nzoId, viewPath: partial.viewPath, fileName: partial.name, status: "ready", category, jobName, inFileSystem: true };
                    await writeStreamState(streamCacheKey, { ...result }, STREAM_TTL_SEC);
                    return result;
                }
                return await buildStream({ urlHash, cacheKey: streamCacheKey, downloadUrl, category, title, jobName, episode, indexer, fileId: guid, signal: req.signal });
            } finally {
                await releaseLock(lockKey, lockToken);
                redis.publish(keys.streamChannel(streamCacheKey), "done").catch(() => {});
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
        if (req.signal.aborted || err.name === "AbortError" || (err instanceof DOMException && err.name === "AbortError")) {
            log(scope, `Client closed request mid-stream`);
            return new Response(null, { status: 499 });
        }
        error(scope, `Stream Error`, err);
        if (err.isNzbdavFailure || err.message?.includes("failed")) {
            redis.setex(failedKey, FAILED_STREAM_TTL_SEC, err.failureMessage || err.message).catch(() => {});
            if (searchKey && downloadUrl) { removeSearchHit(searchKey, downloadUrl).catch(() => {}); invalidateSearchCache(searchKey); }
            else if (id && downloadUrl) { const fallbackKey = keys.search(id); removeSearchHit(fallbackKey, downloadUrl).catch(() => {}); invalidateSearchCache(fallbackKey); }
            if (indexer && guid) updateNzbStatus({ source_indexer: indexer, file_id: guid }, false, err.failureMessage || err.message).catch(() => {});
        }
        return await streamFailureVideo(req, err) || new Response(JSON.stringify({ error: err.failureMessage || err.message }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
}
