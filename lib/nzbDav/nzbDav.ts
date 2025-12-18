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
    status?: "failed" | "ready" | "pending";
    failureMessage?: string;
    nzoId?: string;
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

    constructor(
        message: string,
        failMessage: string,
        nzoId?: string,
        category?: string,
    ) {
        super(message);
        this.failureMessage = failMessage;
        this.nzoId = nzoId;
        this.category = category;
    }
}

// --- Caches ---

const nzbdavStreamCache = new LRU<
    string,
    {
        status: "ready" | "pending" | "failed";
        data?: StreamResult;
        promise?: Promise<StreamResult>;
        error?: any;
    }
>({
    max: Config.NZBDAV_CACHE_MAX_ITEMS,
    ttl: Config.NZBDAV_CACHE_TTL_MS,
});

const streamMetadataCache = new LRU<string, { data: StreamCache }>({
    max: Config.STREAM_METADATA_CACHE_MAX_ITEMS,
    ttl: Config.STREAM_METADATA_CACHE_TTL_MS,
});

// --- Redis scripts ---

const REMOVE_PROWLARR_SCRIPT =
    `local k=KEYS[1];if redis.call("EXISTS",k)==0 then return 0 end;local a=redis.call('JSON.GET',k,'$');if not a then return 0 end;local d=cjson.decode(a);local t=d[1];if not t then return 0 end;local x=-1;for i,v in ipairs(t) do if v.downloadUrl==ARGV[1] then x=i-1;break end end;if x>=0 then redis.call('JSON.ARRPOP',k,'$',x);local l=redis.call('JSON.ARRLEN',k,'$[0]') or 0;if l==0 then redis.call('DEL',k) end;return 1 end;return 0`;

const FAST_FAIL_SCRIPT =
    `local k=KEYS[1];` +
    `local j=redis.call('JSON.GET',k,'$[0].status','$[0].failureMessage','$[0].nzoId','$[0].viewPath','$[0].fileName');` +
    `if not j then return nil end;` +
    `local d=cjson.decode(j);` +
    `local status=d[1] and d[1][1] or nil;` +
    `local failure=d[2] and d[2][1] or nil;` +
    `local nzoId=d[3] and d[3][1] or nil;` +
    `local viewPath=d[4] and d[4][1] or nil;` +
    `local fileName=d[5] and d[5][1] or nil;` +
    `return {status or '', failure or '', nzoId or '', viewPath or '', fileName or ''};`;

// --- Helpers ---

function safeErrMsg(err: unknown): string {
    if (err instanceof Error) return err.message;
    try {
        return String(err);
    } catch {
        return "Unknown error";
    }
}

function normalizeSlot(slot: any): NzbHistorySlot {
    return {
        nzoId: slot.nzo_id || slot.id || slot.nzoId || "",
        status: (slot.status || "").toLowerCase(),
        failMessage: slot.fail_message || slot.failMessage || "",
        category: slot.category || slot.cat || "",
        jobName:
            slot.job_name ||
            slot.jobName ||
            slot.name ||
            slot.nzb_name ||
            slot.nzbName ||
            "",
        name: slot.name || "",
    };
}

function jitter(ms: number, pct = 0.2): number {
    const delta = ms * pct;
    const low = ms - delta;
    const high = ms + delta;
    return Math.max(50, Math.floor(low + Math.random() * (high - low)));
}

function sanitizeJobName(name: string): string {
    let s = name.trim();
    if (s.endsWith(".nzb")) s = s.slice(0, -4);
    if (s.includes("/") || s.includes("\\")) {
        console.warn(`[NZBDAV] Job name contained path characters: "${s}". Sanitizing.`);
        s = s.split(/[/\\]/).pop() || s;
    }
    return s;
}

async function acquireRedisLock(key: string, ttlMs: number): Promise<boolean> {
    const value = String(Date.now());
    const res = await (redis as any).set(key, value, "PX", ttlMs, "NX");
    return res === "OK";
}

async function releaseRedisLock(key: string): Promise<void> {
    try {
        await redis.del(key);
    } catch {
        // ignore
    }
}

async function fastFailRead(
    cacheKey: string,
): Promise<
    | {
        status?: string;
        failureMessage?: string;
        nzoId?: string;
        viewPath?: string;
        fileName?: string;
    }
    | undefined
> {
    try {
        const res = await (redis as any).eval(FAST_FAIL_SCRIPT, cacheKey);
        if (!res || !Array.isArray(res)) return undefined;

        const [status, failureMessage, nzoId, viewPath, fileName] = res as string[];

        return {
            status: status || undefined,
            failureMessage: failureMessage || undefined,
            nzoId: nzoId || undefined,
            viewPath: viewPath || undefined,
            fileName: fileName || undefined,
        };
    } catch {
        return undefined;
    }
}

async function removeFailedProwlarrEntry(redisKey: string, downloadUrl: string) {
    try {
        await (redis as any).eval(REMOVE_PROWLARR_SCRIPT, redisKey, [downloadUrl]);
    } catch (e) {
        console.warn(`[Redis] Failed to clean prowlarr entry:`, e);
    }
}

// --- NZBDAV API ---

export async function fetchNzbdav<T = any>(
    mode: string,
    params: Record<string, string | number | boolean | undefined> = {},
    timeoutMs: number = Config.NZBDAV_API_TIMEOUT_MS ?? 10000,
): Promise<T> {
    const cleanParams: Record<string, string | number | boolean> = {};
    for (const k in params) {
        const v = params[k];
        if (v !== undefined) cleanParams[k] = v as any;
    }

    const finalParams = buildNzbdavApiParams(mode, cleanParams);

    const data = await fetcher<any>(`${Config.NZBDAV_URL}/api`, {
        params: finalParams,
        timeoutMs,
        headers: { "X-API-KEY": Config.NZBDAV_API_KEY || "" },
    });

    if (data?.error) throw new Error(`[NZBDAV] API Error: ${data.error}`);
    return data as T;
}

async function addNzbToNzbdav(
    nzbUrl: string,
    category: string,
    jobLabel: string,
): Promise<{ nzoId: string }> {
    if (!nzbUrl) throw new Error("Missing NZB download URL");

    const jobName = jobLabel || "untitled";
    console.log(`[NZBDAV] Queueing NZB for category=${category} (${jobName})`);

    const json = await fetchNzbdav<any>(
        "addurl",
        { name: nzbUrl, cat: category, nzbname: jobName },
        Config.NZBDAV_API_TIMEOUT_MS,
    );

    const nzoId = json?.nzo_ids?.[0] || json?.nzoId || json?.nzo_id;

    if (!nzoId) {
        console.debug(`[NZBDAV] Response dump:`, json);
        throw new Error("[NZBDAV] addurl succeeded but no nzoId returned");
    }

    console.log(`[NZBDAV] NZB queued with id ${nzoId}`);
    return { nzoId };
}

async function getSabJobNameByNzoId(
    nzoId: string,
    category: string,
    signal?: AbortSignal,
): Promise<string | undefined> {
    const deadline = Date.now() + 12_000;
    let interval = 250;

    while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason;

        try {
            const json = await fetchNzbdav<any>(
                "queue",
                { start: "0", limit: "200", cat: category },
                Config.NZBDAV_API_TIMEOUT_MS,
            );

            const slots: any[] = json?.queue?.slots ?? json?.slots ?? [];
            const hit = slots.find((s) => (s?.nzo_id || s?.nzoId || s?.id) === nzoId);

            if (hit) {
                const name = hit.nzb_name || hit.job_name || hit.filename || hit.name;
                if (typeof name === "string" && name.length > 0) return sanitizeJobName(name);
                return undefined;
            }
        } catch {
            // ignore
        }

        await sleep(jitter(interval, 0.25), signal);
        interval = Math.min(Math.floor(interval * 1.45), 900);
    }

    return undefined;
}

export async function waitForNzbdavCompletion(
    nzoId: string,
    category: string,
    signal?: AbortSignal,
): Promise<NzbHistorySlot> {
    const deadline = Date.now() + Config.NZBDAV_POLL_TIMEOUT_MS;

    let interval = 700;
    const MAX_INTERVAL = 8000;

    while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason;

        try {
            const json = await fetchNzbdav<any>(
                "history",
                { start: "0", limit: "10", nzo_ids: nzoId, category },
                Config.NZBDAV_API_TIMEOUT_MS,
            );

            const slots: any[] = json?.history?.slots ?? json?.slots ?? [];
            const raw = slots.find((s) => (s?.nzo_id || s?.nzoId || s?.id) === nzoId) ?? slots[0];

            if (raw) {
                const slot = normalizeSlot(raw);
                const status = slot.status?.toLowerCase();

                if (status === "completed" || status === "success") return slot;

                if (status === "failed" || status === "error") {
                    const msg = slot.failMessage || "Unknown SABnzbd failure";
                    throw new NzbdavError(`[NZBDAV] Job failed: ${msg}`, msg, nzoId, category);
                }
            }
        } catch (err) {
            if (err instanceof NzbdavError) throw err;
            if ((err as Error)?.name === "AbortError") throw err;
        }

        await sleep(jitter(interval, 0.2), signal);
        interval = Math.min(Math.floor(interval * 1.35), MAX_INTERVAL);
    }

    throw new Error(`[NZBDAV] Job ${nzoId} did not complete within timeout`);
}

// --- Failure persistence (keep) ---

async function markStreamFailed(cacheKey: string, err: NzbdavError) {
    try {
        await setJsonValue(cacheKey, "$.status", "failed");
        await setJsonValue(cacheKey, "$.failureMessage", err.failureMessage || err.message);
        if (err.nzoId) await setJsonValue(cacheKey, "$.nzoId", err.nzoId);
    } catch {
        // ignore
    }
}

// --- Stream build ---

async function buildNzbdavStream(params: {
    urlHash: string;
    cacheKey: string; // streams:${urlHash}
    downloadUrl: string;
    category: string;
    title: string;
    indexer?: string;
    fileId?: string;
    requestedEpisode: EpisodeInfo | undefined;
    signal?: AbortSignal;
}): Promise<StreamResult> {
    const {
        urlHash,
        cacheKey,
        downloadUrl,
        category,
        title,
        requestedEpisode,
        indexer,
        fileId,
        signal,
    } = params;

    // 0) Single round-trip: check failed or ready viewPath
    const ff = await fastFailRead(cacheKey);
    if (ff?.status === "failed") {
        throw new NzbdavError(
            `[NZBDAV] Job failed: ${ff.failureMessage || "SABnzbd job failed"}`,
            ff.failureMessage || "SABnzbd job failed",
            ff.nzoId,
            category,
        );
    }
    if (ff?.viewPath) {
        return {
            viewPath: ff.viewPath,
            fileName: ff.fileName || ff.viewPath.split("/").pop() || "video.mkv",
            inFileSystem: true,
            category,
            jobName: title,
        };
    }

    // 1) Determine intended Job Name logic
    const isAltMount = Config.NZBDAV_URL.includes("altmount");
    const intendedJobName = isAltMount ? urlHash : title;

    // 2) File system pre-existence
    const existingFile = await findBestVideoFile({
        category,
        jobName: intendedJobName,
        requestedEpisode,
    });

    if (existingFile?.viewPath) {
        const result: StreamResult = {
            viewPath: existingFile.viewPath,
            fileName: existingFile.viewPath.split("/").pop() ?? "video.mkv",
            inFileSystem: !Config.USE_STRM_FILES,
            category,
            jobName: intendedJobName,
        };

        setJsonValue(cacheKey, "$", result).catch(() => { });
        return result;
    }

    // 3) Add NZB to SAB (via proxy)
    const proxyUrl = `${Config.ADDON_BASE_URL}/nzb/proxy/${urlHash}.nzb`;
    const { nzoId } = await addNzbToNzbdav(proxyUrl, category, intendedJobName);

    // 4) Completion watcher (background), persist failure quickly
    waitForNzbdavCompletion(nzoId, category)
        .then(() => setJsonValue(cacheKey, "$.status", "ready").catch(() => { }))
        .catch((err) => {
            if (err instanceof NzbdavError) markStreamFailed(cacheKey, err).catch(() => { });
            console.error(`[NZBDAV] Completion watcher failed:`, safeErrMsg(err));
        });

    // 5) Resolve SAB job name quickly, but don’t stall start
    let effectiveJobName = intendedJobName;
    const sabName = await getSabJobNameByNzoId(nzoId, category, signal).catch(() => undefined);
    if (sabName) effectiveJobName = sabName;
    if (isAltMount) effectiveJobName = intendedJobName;

    // 6) Wait until first playable file appears (fast polling + cheap redis fail check)
    const partial = await waitForPartialVideoFile({
        cacheKey,
        category,
        jobName: effectiveJobName,
        requestedEpisode,
        signal,
    });

    const result: StreamResult = {
        nzoId,
        category,
        jobName: effectiveJobName,
        viewPath: partial.viewPath,
        fileName: partial.name,
        downloadUrl,
        guid: fileId,
        indexer,
        title,
        inFileSystem: true,
    };

    setJsonValue(cacheKey, "$", result).catch(() => { });
    return result;
}

async function getOrCreateNzbdavStream(
    cacheKey: string,
    builder: () => Promise<StreamResult>,
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
        if (error?.isNzbdavFailure) nzbdavStreamCache.set(cacheKey, { status: "failed", error });
        else nzbdavStreamCache.delete(cacheKey);
        throw error;
    }
}

// --- Main ---

export async function streamNzbdavProxy(keyHash: string, req: Request): Promise<Response> {
    const redisKey = `streams:${keyHash}`;

    const meta =
        streamMetadataCache.get(redisKey)?.data ??
        await getJsonValue<StreamCache>(redisKey);

    if (!meta) {
        streamMetadataCache.delete(redisKey);

        const failure = await streamFailureVideo(req);
        if (failure != null) return failure as Response;

        return new Response(JSON.stringify({ error: "Stream metadata missing or expired" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
        });
    }

    streamMetadataCache.set(redisKey, { data: meta });

    const { downloadUrl, type = "movie", title = "NZB Stream", prowlarrId, guid, indexer } = meta;
    const id = meta.rawImdbId ?? "";

    const urlHash = md5(downloadUrl);
    const streamCacheKey = `streams:${urlHash}`;

    const distLockKey = `lock:stream_build:${urlHash}`;
    const localLockKey = `stream_build:${urlHash}`;

    const category = getNzbdavCategory(type);
    const episode = parseRequestedEpisode(type, id);

    try {
        // 1) Single round-trip fast path: viewPath or failed
        const ff = await fastFailRead(streamCacheKey);
        if (ff?.status === "failed") {
            throw new NzbdavError(
                `[NZBDAV] Job failed: ${ff.failureMessage || "SABnzbd job failed"}`,
                ff.failureMessage || "SABnzbd job failed",
                ff.nzoId,
                category,
            );
        }
        if (ff?.viewPath) {
            const fileName = ff.fileName || ff.viewPath.split("/").pop() || "video.mkv";
            return await proxyNzbdavStream(req, ff.viewPath, fileName, true);
        }

        // 2) Distributed lock. If someone else is building, wait briefly for it to set viewPath/fail.
        const haveLock = await acquireRedisLock(distLockKey, 45_000);

        if (!haveLock) {
            const deadline = Date.now() + 12_000;
            let interval = 180;

            while (Date.now() < deadline) {
                if (req.signal?.aborted) throw req.signal.reason;

                const ff2 = await fastFailRead(streamCacheKey);
                if (ff2?.status === "failed") {
                    throw new NzbdavError(
                        `[NZBDAV] Job failed: ${ff2.failureMessage || "SABnzbd job failed"}`,
                        ff2.failureMessage || "SABnzbd job failed",
                        ff2.nzoId,
                        category,
                    );
                }
                if (ff2?.viewPath) {
                    const fileName = ff2.fileName || ff2.viewPath.split("/").pop() || "video.mkv";
                    return await proxyNzbdavStream(req, ff2.viewPath, fileName, true);
                }

                await sleep(jitter(interval, 0.25), req.signal);
                interval = Math.min(Math.floor(interval * 1.35), 900);
            }
        }

        // 3) Local in-process de-dupe + build
        const streamData = await getOrCreateNzbdavStream(localLockKey, () =>
            buildNzbdavStream({
                urlHash,
                cacheKey: streamCacheKey,
                downloadUrl,
                category,
                title,
                requestedEpisode: episode,
                indexer,
                fileId: guid,
                signal: req.signal,
            })
        );

        return await proxyNzbdavStream(
            req,
            streamData.viewPath,
            streamData.fileName ?? "video.mkv",
            streamData.inFileSystem,
        );
    } catch (err: any) {
        const msg = err?.message ?? String(err);
        const isNzbdavFail = !!err?.isNzbdavFailure;

        if (isNzbdavFail) {
            const bgTasks: Promise<unknown>[] = [];
            bgTasks.push(redis.del(redisKey));

            if (prowlarrId && downloadUrl) {
                const searchKey = `prowlarr:search:${id}`;
                bgTasks.push(removeFailedProwlarrEntry(searchKey, downloadUrl));
            }

            if (indexer && guid) {
                bgTasks.push(
                    updateNzbStatus(
                        { source_indexer: indexer, file_id: guid },
                        false,
                        err.failureMessage || msg,
                    ),
                );
            }

            Promise.all(bgTasks).catch(() => { });

            return (await streamFailureVideo(req, err)) ||
                new Response(JSON.stringify({ error: msg }), { status: 502 });
        }

        const status = err?.response?.status || 502;
        return new Response(JSON.stringify({ error: err?.failureMessage || msg }), {
            status,
            headers: { "Content-Type": "application/json" },
        });
    } finally {
        releaseRedisLock(distLockKey).catch(() => { });
    }
}

// --- Partial file wait ---

async function waitForPartialVideoFile(params: {
    cacheKey: string;
    category: string;
    jobName: string;
    requestedEpisode?: EpisodeInfo;
    signal?: AbortSignal;
}): Promise<{ viewPath: string; name: string }> {
    const deadline = Date.now() + 60_000;

    const fastPhaseMs = 5_500;
    const fastBase = 320;
    const slowBase = 1600;

    let nextRedisCheck = 0;

    while (Date.now() < deadline) {
        if (params.signal?.aborted) throw params.signal.reason;

        const now = Date.now();

        if (now >= nextRedisCheck) {
            const ff = await fastFailRead(params.cacheKey);

            if (ff?.status === "failed") {
                throw new NzbdavError(
                    `[NZBDAV] Job failed: ${ff.failureMessage || "SABnzbd job failed"}`,
                    ff.failureMessage || "SABnzbd job failed",
                    ff.nzoId,
                    params.category,
                );
            }

            if (ff?.viewPath) {
                return { viewPath: ff.viewPath, name: ff.fileName || ff.viewPath.split("/").pop() || "video.mkv" };
            }

            nextRedisCheck = now + 850;
        }

        const file = await findBestVideoFile({
            category: params.category,
            jobName: params.jobName,
            requestedEpisode: params.requestedEpisode,
            allowPartial: true,
        } as any);

        if (file?.viewPath) {
            return { viewPath: file.viewPath, name: file.name };
        }

        const elapsed = now - (deadline - 60_000);
        const base = elapsed < fastPhaseMs ? fastBase : slowBase;
        await sleep(jitter(base, 0.25), params.signal);
    }

    throw new Error("[NZBDAV] Timed out waiting for partial video file");
}
