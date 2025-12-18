import { normalizeNzbdavPath, getWebdavClient } from "./webdav.ts";
import { Config } from "../env.ts";

interface FileCandidate {
    name: string;
    size: number;
    matchesEpisode: boolean;
    absolutePath: string;
    viewPath: string;
}

interface EpisodeInfo {
    season?: number;
    episode?: number;
}

interface FindFileParams {
    category: string;
    jobName: string;
    requestedEpisode: EpisodeInfo | undefined;
    title?: string;
    allowPartial?: boolean;
}

// Pre-compile constant Regex
const VIDEO_EXT_REGEX =
    /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|m2ts|mpg|mpeg)$/i;

const PUBLIC_BASE_URL = Config.NZBDAV_URL
    .replace(/\/sabnzbd\/?$/, "")
    .replace(/\/$/, "");

// Concurrency is expensive against WebDAV servers; tune carefully.
const MAX_CONCURRENT_REQUESTS = 5;

// Heuristics
const SAMPLE_WORD_RX = /(^|[.\s_\-()[\]])sample([.\s_\-()[\]]|$)/i;

// If allowPartial=true, we still want to avoid selecting a tiny "sample" first.
// For partial streaming, smaller threshold than your 50MB.
const SAMPLE_MIN_BYTES_PARTIAL = 8_000_000; // 8 MB
const SAMPLE_MIN_BYTES_FULL = 52_428_800; // ~50 MB

// For progressive startup: once we find a file at least this big, return immediately.
// Keep small enough to start quickly, but big enough to not be a sample/trailer.
const PROGRESSIVE_GOOD_ENOUGH_BYTES = 25_000_000; // 25 MB

// -------------------------------
// Public entry
// -------------------------------
export async function findBestVideoFile(
    params: FindFileParams,
): Promise<FileCandidate | null> {
    // STRM files are *always* complete — progressive not needed
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

// -------------------------------
// STRM (unchanged)
// -------------------------------
async function findStrmCandidate(
    { category, jobName }: FindFileParams,
): Promise<FileCandidate | null> {
    const safeJobName = jobName.replace(/^\/|\/$/g, "");
    const strmDir = `/strm/content/${category}/${safeJobName}`;

    try {
        const entries = [];
        for await (const entry of Deno.readDir(strmDir)) {
            if (entry.isFile && entry.name.endsWith(".strm")) {
                entries.push(entry);
            }
        }

        if (entries.length === 0) return null;

        const results = await Promise.all(entries.map(async (entry) => {
            try {
                const content = await Deno.readTextFile(`${strmDir}/${entry.name}`);
                if (!content) return null;

                const url = new URL(content.trim());
                const rawPath =
                    url.searchParams.get("path") ||
                    url.pathname.replace("/webdav", "");

                return {
                    viewPath: content.replace(/^https?:\/\/[^/]+/, PUBLIC_BASE_URL),
                    absolutePath: rawPath,
                    name: entry.name.slice(0, -5),
                    size: 0,
                    matchesEpisode: true,
                } as FileCandidate;
            } catch {
                return null;
            }
        }));

        return (results.find(Boolean) as FileCandidate | undefined) || null;
    } catch {
        return null;
    }
}

// -------------------------------
// WebDAV (progressive-aware)
// -------------------------------
export async function findWebdavCandidate(
    { category, jobName, requestedEpisode, allowPartial }: FindFileParams,
): Promise<FileCandidate | null> {
    const client = getWebdavClient();
    const rootPath = normalizeNzbdavPath(`/content/${category}/${jobName}`)
        .replace(/\/$/, "");

    let episodeRegex: RegExp | null = null;
    if (requestedEpisode?.season && requestedEpisode?.episode) {
        episodeRegex = new RegExp(
            `(?:s0*${requestedEpisode.season}[. ]?e0*${requestedEpisode.episode}|0*${requestedEpisode.season}x0*${requestedEpisode.episode})(?![0-9])`,
            "i",
        );
    }

    // BFS queue of dirs
    const queue: Array<{ path: string; depth: number }> = [{ path: rootPath, depth: 0 }];
    const visited = new Set<string>();

    // Track in-flight tasks
    const processing = new Set<Promise<void>>();

    // Cancellation for early-exit (big perf win under allowPartial)
    let done = false;

    let bestEpisode: FileCandidate | null = null;
    let bestGeneric: FileCandidate | null = null;

    const minSampleBytes = allowPartial ? SAMPLE_MIN_BYTES_PARTIAL : SAMPLE_MIN_BYTES_FULL;

    function isSampleLike(name: string, size: number): boolean {
        if (!SAMPLE_WORD_RX.test(name)) return false;
        // If it says "sample" and it's small-ish, treat as sample.
        return size < minSampleBytes;
    }

    function considerCandidate(candidate: FileCandidate) {
        if (candidate.matchesEpisode) {
            if (!bestEpisode || candidate.size > bestEpisode.size) bestEpisode = candidate;
        } else if (!bestEpisode) {
            if (!bestGeneric || candidate.size > bestGeneric.size) bestGeneric = candidate;
        }

        // Early exit path for progressive mode:
        // If partial streaming is enabled, the *first* decently sized episode match is enough.
        if (allowPartial) {
            const pick = bestEpisode || bestGeneric;
            if (pick && pick.size >= PROGRESSIVE_GOOD_ENOUGH_BYTES) {
                done = true;
            }
        }
    }

    // Adaptive concurrency: be gentle at root (common bottleneck)
    function maxConcurrencyForDepth(depth: number): number {
        if (depth <= 0) return Math.min(2, MAX_CONCURRENT_REQUESTS);
        if (depth === 1) return Math.min(3, MAX_CONCURRENT_REQUESTS);
        return MAX_CONCURRENT_REQUESTS;
    }

    const processDirectory = async (path: string, depth: number) => {
        if (done) return;

        // Normalize and dedupe directories
        const key = path.endsWith("/") ? path : `${path}/`;
        if (visited.has(key)) return;
        visited.add(key);

        const entries = await client.getDirectoryContents(path);
        if (done) return;

        const sep = path.endsWith("/") ? "" : "/";

        for (const entry of entries) {
            if (done) return;

            if (entry.isDirectory) {
                if (depth < Config.NZBDAV_MAX_DIRECTORY_DEPTH) {
                    // Avoid obvious junk dirs early if you want (optional):
                    // const n = (entry.name || "").toLowerCase();
                    // if (n === "extras" || n === "featurettes") continue;

                    queue.push({ path: `${path}${sep}${entry.name}`, depth: depth + 1 });
                }
                continue;
            }

            const name = entry.name || "";
            if (!VIDEO_EXT_REGEX.test(name)) continue;

            const size = Number(entry.size) || 0;

            // Filter sample-like clips (even in partial mode, but with softer threshold)
            if (isSampleLike(name.toLowerCase(), size)) continue;

            const matchesEpisode = episodeRegex ? episodeRegex.test(name) : true;
            const fullPath = `${path}${sep}${name}`;

            const candidate: FileCandidate = {
                name,
                size,
                matchesEpisode,
                absolutePath: fullPath,
                viewPath: fullPath.startsWith("/") ? fullPath.slice(1) : fullPath,
            };

            considerCandidate(candidate);
        }
    };

    while (!done && (queue.length || processing.size)) {
        // Start as many tasks as allowed (adaptive)
        while (!done && queue.length) {
            const next = queue[0];
            const cap = maxConcurrencyForDepth(next.depth);

            if (processing.size >= cap) break;

            queue.shift();
            if (!next) break;

            const task = processDirectory(next.path, next.depth)
                .finally(() => processing.delete(task));

            processing.add(task);
        }

        // Wait for any task to finish
        if (processing.size) {
            await Promise.race(processing);
        }
    }

    return bestEpisode || bestGeneric || null;
}
