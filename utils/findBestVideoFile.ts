import { normalizeNzbdavPath, getWebdavClient } from "./webdav.ts";
import { Config } from "../env.ts";
import { keys, WEBDAV_MISS_TTL_SEC, WEBDAV_TTL_SEC } from "./cacheKeys.ts";
import { getJsonValue, setJsonValue } from "./redis.ts";

export interface FileCandidate {
    name: string;
    size: number;
    matchesEpisode: boolean;
    absolutePath: string;
    viewPath: string;
}

export interface EpisodeInfo {
    season?: number;
    episode?: number;
}

export interface FindFileParams {
    category: string;
    jobName: string;
    requestedEpisode: EpisodeInfo | undefined;
    title?: string;
    allowPartial?: boolean;
}

function publicBaseUrl(): string {
    return Config.NZBDAV_URL.replace(/\/sabnzbd\/?$/, "").replace(/\/$/, "");
}

function webdavCacheKey(params: FindFileParams): string {
    return keys.webdav(
        params.category,
        params.jobName,
        params.requestedEpisode?.season,
        params.requestedEpisode?.episode,
        params.allowPartial,
    );
}

const VIDEO_EXTS = new Set([
    "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "ts", "m2ts", "mpg", "mpeg"
]);

const SAMPLE_WORD_RX = /(^|[.\s_\-()[\]])sample([.\s_\-()[\]]|$)/i;
const MAX_CONCURRENT_REQUESTS = 5;
const SAMPLE_MIN_BYTES_PARTIAL = 8_000_000;
const SAMPLE_MIN_BYTES_FULL = 52_428_800;
const PROGRESSIVE_GOOD_ENOUGH_BYTES = 25_000_000;

function getEpisodeRegex(requestedEpisode?: EpisodeInfo): RegExp | null {
    if (requestedEpisode?.season == null || requestedEpisode?.episode == null) return null;
    return new RegExp(
        `(?:s0*${requestedEpisode.season}[. ]?e0*${requestedEpisode.episode}|0*${requestedEpisode.season}x0*${requestedEpisode.episode})(?![0-9])`,
        "i",
    );
}

export async function findBestVideoFile(
    params: FindFileParams,
): Promise<FileCandidate | null> {
    const cacheKey = webdavCacheKey(params);
    const cached = await getJsonValue<FileCandidate & { pending?: boolean }>(cacheKey);
    if (cached?.pending) return null;
    if (cached?.viewPath) return cached;

    let found: FileCandidate | null = null;

    if (Config.USE_STRM_FILES) {
        found = await findStrmCandidate(params);
    }

    if (!found) {
        try {
            found = await findWebdavCandidate(params);
        } catch (e: any) {
            if (e?.status === 404 || e?.message?.includes?.("404")) found = null;
            else throw e;
        }
    }

    if (found?.viewPath) {
        setJsonValue(cacheKey, "$", found, WEBDAV_TTL_SEC).catch(() => {});
    } else {
        setJsonValue(cacheKey, "$", { pending: true }, WEBDAV_MISS_TTL_SEC).catch(() => {});
    }
    return found;
}

async function findStrmCandidate(
    { category, jobName, requestedEpisode }: FindFileParams,
): Promise<FileCandidate | null> {
    const safeJobName = jobName.replace(/^\/|\/$/g, "");
    const strmDir = `/strm/content/${category}/${safeJobName}`;
    const episodeRegex = getEpisodeRegex(requestedEpisode);
    let bestGeneric: FileCandidate | null = null;

    try {
        for await (const entry of Deno.readDir(strmDir)) {
            if (!entry.isFile || !entry.name.endsWith(".strm")) continue;
            const matchesEpisode = episodeRegex ? episodeRegex.test(entry.name) : true;
            if (!matchesEpisode && bestGeneric) continue;
            try {
                const content = await Deno.readTextFile(`${strmDir}/${entry.name}`);
                if (!content) continue;
                const url = new URL(content.trim());
                const rawPath = url.searchParams.get("path") || url.pathname.replace("/webdav", "");
                const candidate: FileCandidate = {
                    viewPath: content.replace(/^https?:\/\/[^/]+/, publicBaseUrl()),
                    absolutePath: rawPath,
                    name: entry.name.slice(0, -5),
                    size: 0,
                    matchesEpisode,
                };
                if (matchesEpisode) return candidate;
                bestGeneric = candidate;
            } catch {
                continue;
            }
        }
        return bestGeneric;
    } catch {
        return null;
    }
}

export async function findWebdavCandidate(
    { category, jobName, requestedEpisode, allowPartial }: FindFileParams,
): Promise<FileCandidate | null> {
    const client = getWebdavClient();
    const rootPath = normalizeNzbdavPath(`/content/${category}/${jobName}`).replace(/\/$/, "");
    const episodeRegex = getEpisodeRegex(requestedEpisode);
    const queue: Array<{ path: string; depth: number }> = [{ path: rootPath, depth: 0 }];
    let queueIdx = 0;
    const visited = new Set<string>();
    const processing = new Set<Promise<void>>();
    let done = false;
    let bestEpisode: FileCandidate | null = null;
    let bestGeneric: FileCandidate | null = null;
    const minSampleBytes = allowPartial ? SAMPLE_MIN_BYTES_PARTIAL : SAMPLE_MIN_BYTES_FULL;

    function isSampleLike(name: string, size: number): boolean {
        if (size >= minSampleBytes) return false;
        return SAMPLE_WORD_RX.test(name);
    }

    function maxConcurrencyForDepth(depth: number): number {
        if (depth <= 0) return Math.min(2, MAX_CONCURRENT_REQUESTS);
        if (depth === 1) return Math.min(3, MAX_CONCURRENT_REQUESTS);
        return MAX_CONCURRENT_REQUESTS;
    }

    const processDirectory = async (path: string, depth: number) => {
        if (done) return;
        const key = path.endsWith("/") ? path : `${path}/`;
        if (visited.has(key)) return;
        visited.add(key);
        const entries = await client.getDirectoryContents(path);
        if (done) return;
        const sep = path.endsWith("/") ? "" : "/";
        for (let i = 0; i < entries.length; i++) {
            if (done) return;
            const entry = entries[i];
            if (entry.isDirectory) {
                if (depth < Config.NZBDAV_MAX_DIRECTORY_DEPTH) {
                    queue.push({ path: `${path}${sep}${entry.name}`, depth: depth + 1 });
                }
                continue;
            }
            const name = entry.name || "";
            const dotIdx = name.lastIndexOf(".");
            if (dotIdx === -1) continue;
            const ext = name.slice(dotIdx + 1).toLowerCase();
            if (!VIDEO_EXTS.has(ext)) continue;
            const size = Number(entry.size) || 0;
            if (isSampleLike(name, size)) continue;
            const matchesEpisode = episodeRegex ? episodeRegex.test(name) : true;
            if (matchesEpisode) {
                if (bestEpisode && size <= bestEpisode.size) continue;
            } else if (bestGeneric && size <= bestGeneric.size) {
                continue;
            }
            const fullPath = `${path}${sep}${name}`;
            const candidate: FileCandidate = {
                name,
                size,
                matchesEpisode,
                absolutePath: fullPath,
                viewPath: fullPath.startsWith("/") ? fullPath.slice(1) : fullPath,
            };
            if (matchesEpisode) bestEpisode = candidate;
            else bestGeneric = candidate;
            if (allowPartial) {
                const pick = episodeRegex ? bestEpisode : (bestEpisode || bestGeneric);
                if (pick && pick.size >= PROGRESSIVE_GOOD_ENOUGH_BYTES) done = true;
            }
        }
    };

    while (!done && (queueIdx < queue.length || processing.size > 0)) {
        while (!done && queueIdx < queue.length) {
            const next = queue[queueIdx];
            if (processing.size >= maxConcurrencyForDepth(next.depth)) break;
            queueIdx++;
            const task = processDirectory(next.path, next.depth).finally(() => {
                processing.delete(task);
            });
            processing.add(task);
        }
        if (processing.size > 0) await Promise.race(processing);
    }

    return bestEpisode || bestGeneric || null;
}
