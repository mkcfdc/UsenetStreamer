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
}

// Pre-compile constant Regex
const VIDEO_EXT_REGEX = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|m2ts|mpg|mpeg)$/i;
// Pre-calculate base URL for STRM replacement
const PUBLIC_BASE_URL = Config.NZBDAV_URL.replace(/\/sabnzbd\/?$/, "").replace(/\/$/, "");

const MAX_CONCURRENT_REQUESTS = 5;

export async function findBestVideoFile(params: FindFileParams): Promise<FileCandidate | null> {
    // 1. Check local STRM files first (Fastest - Local FS)
    if (Config.USE_STRM_FILES) {
        const strmCandidate = await findStrmCandidate(params);
        if (strmCandidate) return strmCandidate;
    }

    // 2. Scan WebDAV (Network - Slower)
    try {
        return await findWebdavCandidate(params);
    } catch (e: any) {
        // Fast Fail: If root folder 404s, stop immediately.
        // We check string and status to handle different library error shapes.
        if (e.status === 404 || (e.message && e.message.includes("404"))) {
            return null;
        }
        throw e;
    }
}

async function findStrmCandidate({ category, jobName }: FindFileParams): Promise<FileCandidate | null> {
    const safeJobName = jobName.replace(/^\/|\/$/g, "");
    const strmDir = `/strm/content/${category}/${safeJobName}`;

    try {
        // optimization: Don't use Deno.stat first. Just try readDir. 
        // If it fails, we catch the error. Saves 1 syscall.
        const entries = [];
        for await (const entry of Deno.readDir(strmDir)) {
            if (entry.isFile && entry.name.toLowerCase().endsWith(".strm")) {
                entries.push(entry);
            }
        }

        if (entries.length === 0) return null;

        // optimization: Read all text files in parallel, not serially
        const results = await Promise.all(entries.map(async (entry) => {
            try {
                const strmFilePath = `${strmDir}/${entry.name}`;
                const content = await Deno.readTextFile(strmFilePath);
                const urlStr = content.trim();
                if (!urlStr) return null;

                // Manual string manipulation is faster than new URL() if format is known,
                // but URL() is safer. We stick to URL() for safety here.
                const urlObj = new URL(urlStr);
                const rawPath = urlObj.searchParams.get("path") || urlObj.pathname.replace("/webdav", "");

                // Fast replacement
                const viewPath = urlStr.replace(/^https?:\/\/[^/]+/, PUBLIC_BASE_URL);

                return {
                    viewPath,
                    absolutePath: rawPath,
                    name: entry.name.slice(0, -5), // faster than replace(".strm", "")
                    size: 0,
                    matchesEpisode: true,
                } as FileCandidate;
            } catch (e) {
                console.warn(`[STRM] Read error ${entry.name}:`, e);
                return null;
            }
        }));

        // Return the first valid one found
        return results.find(r => r !== null) || null;

    } catch (e) {
        // Directory likely doesn't exist
        return null;
    }
}

export async function findWebdavCandidate({ category, jobName, requestedEpisode }: FindFileParams): Promise<FileCandidate | null> {
    const client = getWebdavClient();

    // Optimize path normalization once
    const rootPath = normalizeNzbdavPath(`/content/${category}/${jobName}`).replace(/\/$/, "");

    let episodeRegex: RegExp | null = null;
    if (requestedEpisode?.season && requestedEpisode?.episode) {
        const { season, episode } = requestedEpisode;
        // Optimization: Create regex once. Added boundary check (?![0-9]) to avoid matching S01E011 as S01E01
        episodeRegex = new RegExp(
            `(?:s0*${season}[. ]?e0*${episode}|0*${season}x0*${episode})(?![0-9])`,
            "i"
        );
    }

    // BFS Queue
    const queue = [{ path: rootPath, depth: 0 }];

    // Concurrency control
    const processing = new Set<Promise<void>>();

    let bestMatch: FileCandidate | null = null;
    let bestEpisodeMatch: FileCandidate | null = null;

    const processDirectory = async (currentPath: string, depth: number) => {
        try {
            const entries = await client.getDirectoryContents(currentPath);

            // Pre-calculate separator to avoid doing it in the loop
            const separator = currentPath.endsWith("/") ? "" : "/";

            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];

                if (entry.isDirectory) {
                    if (depth < Config.NZBDAV_MAX_DIRECTORY_DEPTH) {
                        // Construct path manually to avoid normalization overhead
                        queue.push({
                            path: `${currentPath}${separator}${entry.name}`,
                            depth: depth + 1
                        });
                    }
                    continue;
                }

                // Fast extension check
                if (!VIDEO_EXT_REGEX.test(entry.name)) continue;

                // optimization: client now returns number | null, no need for parseInt
                const size = entry.size || 0;

                // Sample check (under 50MB and contains "sample")
                if (size < 52428800 && entry.name.toLowerCase().includes("sample")) continue;

                const matchesEpisode = episodeRegex ? episodeRegex.test(entry.name) : true;

                const fullEntryPath = `${currentPath}${separator}${entry.name}`;

                const candidate: FileCandidate = {
                    name: entry.name,
                    size: size,
                    matchesEpisode,
                    absolutePath: fullEntryPath,
                    // Fast substring for viewPath (remove leading slash)
                    viewPath: fullEntryPath.charCodeAt(0) === 47 ? fullEntryPath.substring(1) : fullEntryPath,
                };

                // Logic: Prioritize Episode Match, then Size
                if (matchesEpisode) {
                    if (!bestEpisodeMatch || size > bestEpisodeMatch.size) {
                        bestEpisodeMatch = candidate;
                    }
                } else if (!bestEpisodeMatch) {
                    // Only track generic best match if we haven't found an episode match yet
                    // (Minor optimization: we still track it, but we care less)
                    if (!bestMatch || size > bestMatch.size) {
                        bestMatch = candidate;
                    }
                }
            }
        } catch (e: any) {
            // Critical: Fail fast if the Root directory is missing
            if (depth === 0) throw e;
            // Otherwise ignore sub-folder permission errors
        }
    };

    // Optimized Concurrency Loop
    while (queue.length > 0 || processing.size > 0) {

        // Fill the pool
        while (queue.length > 0 && processing.size < MAX_CONCURRENT_REQUESTS) {
            const next = queue.shift();
            if (!next) break;

            const promise = processDirectory(next.path, next.depth);

            // Wrap promise to handle cleanup in the Set
            const task = promise.then(() => {
                processing.delete(task);
            }).catch((e) => {
                processing.delete(task);
                if (next.depth === 0) throw e; // Propagate root error
            });

            processing.add(task);
        }

        // Wait for *at least one* to finish before refilling the pool
        if (processing.size > 0) {
            await Promise.race(processing);
        }
    }

    return bestEpisodeMatch || bestMatch || null;
}
