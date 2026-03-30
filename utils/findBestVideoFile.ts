import { normalizeNzbdavPath, getWebdavClient } from "./webdav.ts";
import { Config } from "../env.ts";

// ═══════════════════════════════════════════════════════════════════
// Interfaces & Configuration
// ═══════════════════════════════════════════════════════════════════

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

const PUBLIC_BASE_URL = Config.NZBDAV_URL
    .replace(/\/sabnzbd\/?$/, "")
    .replace(/\/$/, "");

// Performance: Sets are vastly faster than Regex for known strict matches
const VIDEO_EXTS = new Set([
    "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "ts", "m2ts", "mpg", "mpeg"
]);

const SAMPLE_WORD_RX = /(^|[.\s_\-()[\]])sample([.\s_\-()[\]]|$)/i;
const MAX_CONCURRENT_REQUESTS = 5;

const SAMPLE_MIN_BYTES_PARTIAL = 8_000_000;  // 8 MB
const SAMPLE_MIN_BYTES_FULL = 52_428_800;    // ~50 MB
const PROGRESSIVE_GOOD_ENOUGH_BYTES = 25_000_000; // 25 MB

// Helper to pre-compile episode regex
function getEpisodeRegex(requestedEpisode?: EpisodeInfo): RegExp | null {
    if (!requestedEpisode?.season || !requestedEpisode?.episode) return null;
    return new RegExp(
        `(?:s0*${requestedEpisode.season}[. ]?e0*${requestedEpisode.episode}|0*${requestedEpisode.season}x0*${requestedEpisode.episode})(?![0-9])`,
        "i",
    );
}

// ═══════════════════════════════════════════════════════════════════
// Public Entry
// ═══════════════════════════════════════════════════════════════════

export async function findBestVideoFile(
    params: FindFileParams,
): Promise<FileCandidate | null> {
    if (Config.USE_STRM_FILES) {
        const strm = await findStrmCandidate(params);
        if (strm) return strm;
    }

    try {
        return await findWebdavCandidate(params);
    } catch (e: any) {
        if (e?.status === 404 || e?.message?.includes?.("404")) return null;
        throw e;
    }
}

// ═══════════════════════════════════════════════════════════════════
// STRM Optimization
// ═══════════════════════════════════════════════════════════════════

async function findStrmCandidate(
    { category, jobName, requestedEpisode }: FindFileParams,
): Promise<FileCandidate | null> {
    const safeJobName = jobName.replace(/^\/|\/$/g, "");
    const strmDir = `/strm/content/${category}/${safeJobName}`;
    const episodeRegex = getEpisodeRegex(requestedEpisode);

    let bestGeneric: FileCandidate | null = null;

    try {
        // Optimized: Streams files natively and stops reading IO as soon as exact match is found
        for await (const entry of Deno.readDir(strmDir)) {
            if (!entry.isFile || !entry.name.endsWith(".strm")) continue;

            const matchesEpisode = episodeRegex ? episodeRegex.test(entry.name) : true;

            // If we already have a generic, don't read another generic from disk
            if (!matchesEpisode && bestGeneric) continue;

            try {
                const content = await Deno.readTextFile(`${strmDir}/${entry.name}`);
                if (!content) continue;

                const url = new URL(content.trim());
                const rawPath = url.searchParams.get("path") || url.pathname.replace("/webdav", "");

                const candidate: FileCandidate = {
                    viewPath: content.replace(/^https?:\/\/[^/]+/, PUBLIC_BASE_URL),
                    absolutePath: rawPath,
                    name: entry.name.slice(0, -5),
                    size: 0,
                    matchesEpisode,
                };

                if (matchesEpisode) {
                    return candidate; // Early exit: exact episode found
                } else {
                    bestGeneric = candidate; // Save as fallback
                }
            } catch {
                continue;
            }
        }
        return bestGeneric;
    } catch {
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════
// WebDAV Optimization
// ═══════════════════════════════════════════════════════════════════

export async function findWebdavCandidate(
    { category, jobName, requestedEpisode, allowPartial }: FindFileParams,
): Promise<FileCandidate | null> {
    const client = getWebdavClient();
    const rootPath = normalizeNzbdavPath(`/content/${category}/${jobName}`).replace(/\/$/, "");
    const episodeRegex = getEpisodeRegex(requestedEpisode);

    // BFS queue - using an index avoids $O(N) queue.shift() re-allocations
    const queue: Array<{ path: string; depth: number }> = [{ path: rootPath, depth: 0 }];
    let queueIdx = 0;

    const visited = new Set<string>();
    const processing = new Set<Promise<void>>();

    let done = false;
    let bestEpisode: FileCandidate | null = null;
    let bestGeneric: FileCandidate | null = null;

    const minSampleBytes = allowPartial ? SAMPLE_MIN_BYTES_PARTIAL : SAMPLE_MIN_BYTES_FULL;

    // Optimized: Only run Regex if the file is smaller than threshold
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

            // Fast Extension Check via Set
            const dotIdx = name.lastIndexOf(".");
            if (dotIdx === -1) continue;
            const ext = name.slice(dotIdx + 1).toLowerCase();
            if (!VIDEO_EXTS.has(ext)) continue;

            const size = Number(entry.size) || 0;
            if (isSampleLike(name, size)) continue;

            const matchesEpisode = episodeRegex ? episodeRegex.test(name) : true;

            // Prevent Object allocation / Garbage Collection if file is smaller than current best
            if (matchesEpisode) {
                if (bestEpisode && size <= bestEpisode.size) continue;
            } else {
                if (bestGeneric && size <= bestGeneric.size) continue;
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

            // Early exit path for progressive mode (Bugfix applied)
            if (allowPartial) {
                // If we specifically wanted an episode, only early-exit if bestEpisode is populated
                const pick = episodeRegex ? bestEpisode : (bestEpisode || bestGeneric);
                if (pick && pick.size >= PROGRESSIVE_GOOD_ENOUGH_BYTES) {
                    done = true;
                }
            }
        }
    };

    while (!done && (queueIdx < queue.length || processing.size > 0)) {

        // Spawn workers up to concurrency limit
        while (!done && queueIdx < queue.length) {
            const next = queue[queueIdx];
            if (processing.size >= maxConcurrencyForDepth(next.depth)) break;

            queueIdx++; // O(1) advance
            const task = processDirectory(next.path, next.depth).finally(() => {
                processing.delete(task);
            });
            processing.add(task);
        }

        // Wait for at least one worker to finish before continuing
        if (processing.size > 0) {
            // Promise.race natively supports iterables like Set in V8
            await Promise.race(processing);
        }
    }

    return bestEpisode || bestGeneric || null;
}
