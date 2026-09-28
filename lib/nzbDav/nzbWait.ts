// deno-lint-ignore-file no-explicit-any
import { getStreamStatus, mergeJson } from "../../utils/redis.ts";
import { STREAM_TTL_SEC } from "../../utils/cacheKeys.ts";
import { findBestVideoFile } from "../../utils/findBestVideoFile.ts";
import { type EpisodeInfo } from "../../utils/parseRequestedEpisode.ts";
import { fetcher } from "../../utils/fetcher.ts";
import { Config } from "../../env.ts";
import { buildNzbdavApiParams, sleep } from "./nzbUtils.ts";
import { NzbdavError } from "./nzbAdd.ts";

const POLLING = {
    INITIAL_WAIT: 120,
    MAX_WAIT: 400,
    FIRST_FS_WAIT: 120,
};

const now = performance.now.bind(performance);
const dur = (start: number) => (performance.now() - start).toFixed(0);
const timestamp = () => new Date().toISOString().slice(11, -1);
const log = (scope: string, msg: string, ...args: any[]) =>
    console.log(`[${timestamp()}] [${scope}] ${msg}`, ...args);
const error = (scope: string, msg: string, err?: any) =>
    console.error(`[${timestamp()}] [${scope}] ERROR: ${msg}`, err instanceof Error ? err.message : err);

function isAbort(err: unknown): boolean {
    return (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError");
}

async function fetchHistory(nzoId: string, category: string): Promise<any> {
    return await fetcher<any>(`${Config.NZBDAV_URL}/api`, {
        params: buildNzbdavApiParams("history", { start: "0", limit: "10", nzo_ids: nzoId, category }),
        timeoutMs: Config.NZBDAV_HISTORY_TIMEOUT_MS ?? 60000,
        headers: { "X-API-KEY": Config.NZBDAV_API_KEY || "" },
    });
}

async function poll<T>(
    fn: () => Promise<T | undefined>,
    opts: { timeout: number; initialWait?: number; maxWait?: number; signal?: AbortSignal },
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

export async function writeStreamState(
    cacheKey: string,
    next: Record<string, unknown>,
    ttl?: number,
): Promise<boolean> {
    const current = await getStreamStatus(cacheKey);
    const from = current?.status;
    const playing = from === "ready" || from === "partial" || Boolean(current?.viewPath);
    if (next.status === "failed" && playing) {
        log("State", `Skip failed overwrite; already ${from || "playing"} ${cacheKey}`);
        return false;
    }
    return mergeJson(cacheKey, next, ttl);
}

export async function resolveVideoFile(
    category: string,
    jobName: string,
    episode?: EpisodeInfo,
    allowPartial = true,
): Promise<{ viewPath: string; name: string } | null> {
    const file = await findBestVideoFile({
        category,
        jobName,
        requestedEpisode: episode,
        allowPartial,
    });
    if (!file?.viewPath) return null;
    return { viewPath: file.viewPath, name: file.name };
}

export async function monitorNzbdavJob(
    nzoId: string,
    category: string,
    cacheKey: string,
    jobName: string,
    episode?: EpisodeInfo,
): Promise<void> {
    const deadline = Date.now() + Config.NZBDAV_POLL_TIMEOUT_MS;
    let interval = 500;
    log("Monitor", `Starting bg monitor for ${nzoId}`);

    try {
        while (Date.now() < deadline) {
            const json = await fetchHistory(nzoId, category);
            const slots = json?.history?.slots ?? json?.slots ?? [];
            const raw = slots.find((s: any) => (s?.nzo_id || s?.id) === nzoId) ?? slots[0];

            if (raw) {
                const status = (raw.status || "").toLowerCase();
                if (status === "completed" || status === "success") {
                    log("Monitor", `Job ${nzoId} completed`);
                    const file = await resolveVideoFile(category, jobName, episode, true);
                    if (file) {
                        await writeStreamState(cacheKey, {
                            status: "ready",
                            viewPath: file.viewPath,
                            fileName: file.name,
                            nzoId,
                        }, STREAM_TTL_SEC);
                        log("Monitor", `Wrote viewPath after complete: ${file.viewPath}`);
                    } else {
                        await writeStreamState(cacheKey, { status: "ready", nzoId }, STREAM_TTL_SEC);
                    }
                    return;
                }
                if (status === "failed" || status === "error") {
                    throw new NzbdavError(
                        `Job failed: ${raw.fail_message || raw.failMessage || "Unknown"}`,
                        raw.fail_message || raw.failMessage || "Unknown error",
                        nzoId,
                        category,
                    );
                }
            }

            const early = await resolveVideoFile(category, jobName, episode, true);
            if (early) {
                await writeStreamState(cacheKey, {
                    status: "partial",
                    viewPath: early.viewPath,
                    fileName: early.name,
                    nzoId,
                }, STREAM_TTL_SEC);
                log("Monitor", `Partial file while job running: ${early.viewPath}`);
                return;
            }

            await sleep(interval);
            interval = Math.min(interval * 1.5, 3000);
        }
        log("Monitor", `Job ${nzoId} timed out`);
    } catch (err: any) {
        if (isAbort(err)) {
            log("Monitor", `Stopped for ${nzoId} (aborted)`);
            return;
        }
        error("Monitor", `Failed for ${nzoId}`, err);
        const wrote = await writeStreamState(cacheKey, {
            status: "failed",
            failureMessage: err.failureMessage || err.message,
            nzoId: err.nzoId || nzoId,
        }).catch((e) => {
            error("Monitor", "Failed to write error state", e);
            return false;
        });
        if (wrote) log("Monitor", `Marked ${cacheKey} as failed`);
    }
}

export async function waitForPartialVideoFile(
    cacheKey: string,
    category: string,
    jobName: string,
    episode?: EpisodeInfo,
    signal?: AbortSignal,
): Promise<{ viewPath: string; name: string }> {
    const tStart = now();
    const timeout = Config.NZBDAV_POLL_TIMEOUT_MS;
    log("Wait", `Waiting for media file. Job: ${jobName} timeout=${timeout}ms`);
    await sleep(POLLING.FIRST_FS_WAIT, signal);

    try {
        return await poll(async () => {
            const status = await getStreamStatus(cacheKey);
            if (status?.status === "failed") {
                throw new NzbdavError(
                    `Job failed: ${status.failureMessage}`,
                    status.failureMessage || "Job failed",
                    status.nzoId,
                    category,
                );
            }
            if (status?.viewPath) {
                log("Wait", `Found in Redis after ${dur(tStart)}ms`);
                return { viewPath: status.viewPath, name: status.fileName || "video.mkv" };
            }
            const file = await resolveVideoFile(category, jobName, episode, true);
            if (file) {
                log("Wait", `Found on FS after ${dur(tStart)}ms`);
                await writeStreamState(cacheKey, {
                    status: "partial",
                    viewPath: file.viewPath,
                    fileName: file.name,
                }, STREAM_TTL_SEC);
                return file;
            }
        }, { timeout, signal });
    } catch (err) {
        if (isAbort(err)) throw err;
        const lastChance = await resolveVideoFile(category, jobName, episode, true);
        if (lastChance) {
            log("Wait", `Last-chance FS hit after ${dur(tStart)}ms`);
            await writeStreamState(cacheKey, {
                status: "partial",
                viewPath: lastChance.viewPath,
                fileName: lastChance.name,
            }, STREAM_TTL_SEC);
            return lastChance;
        }
        throw err;
    }
}
