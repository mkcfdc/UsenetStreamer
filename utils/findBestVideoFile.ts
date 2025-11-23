import { normalizeNzbdavPath, getWebdavClient } from "./webdav.ts";
import { NZBDAV_MAX_DIRECTORY_DEPTH, NZBDAV_URL, USE_STRM_FILES } from "../env.ts";

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

const VIDEO_EXT_REGEX = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|m2ts|mpg|mpeg)$/i;
const MAX_CONCURRENT_REQUESTS = 5; // Adjust based on server limits

export async function findBestVideoFile(params: FindFileParams): Promise<FileCandidate | null> {
    // 1. Strategy: Check local STRM files first (Fastest)
    if (USE_STRM_FILES) {
        const strmCandidate = await findStrmCandidate(params);
        if (strmCandidate) return strmCandidate;
    }

    // 2. Strategy: Scan WebDAV directory (Recursive/Fallback)
    return await findWebdavCandidate(params);
}

/**
 * Strategy 1: Local STRM File Check
 * Checks specific local directories for .strm files pointing to the content.
 */
async function findStrmCandidate({ category, jobName }: FindFileParams): Promise<FileCandidate | null> {
    const strmDir = `/strm/content/${category}/${jobName}/`;

    console.log(`[STRM] Checking directory: ${strmDir}`);

    // Check if directory exists
    try {
        const stat = await Deno.stat(strmDir);
        if (!stat.isDirectory) return null;
    } catch {
        console.log(`[STRM] Directory not found: ${strmDir}`);
        return null; // Dir doesn't exist
    }

    // Iterate directory
    for await (const entry of Deno.readDir(strmDir)) {
        if (!entry.isFile || !entry.name.toLowerCase().endsWith(".strm")) continue;

        const strmFilePath = `${strmDir}${entry.name}`;
        console.log(`[STRM] Found STRM file: ${strmFilePath}`);

        try {
            const content = await Deno.readTextFile(strmFilePath);
            const urlStr = content.trim();
            if (!urlStr) continue;

            const urlObj = new URL(urlStr);
            const pathParam = urlObj.searchParams.get("path");

            if (!pathParam) continue;

            const publicBaseUrl = NZBDAV_URL.replace(/\/sabnzbd\/?$/, "");
            const viewPath = urlStr.replace("http://localhost:8080", publicBaseUrl);
            const fileName = pathParam.split("/").pop() || entry.name;

            return {
                viewPath,
                absolutePath: pathParam,
                name: fileName,
                size: 0,
                matchesEpisode: true, // If a STRM exists for this specific job, it's a match
            };

        } catch (e) {
            console.warn(`[STRM] Error reading file ${strmFilePath}:`, e);
        }
    }

    console.log(`[STRM] No valid *.strm files found in ${strmDir}`);
    return null;
}

export async function findWebdavCandidate({ category, jobName, requestedEpisode }: FindFileParams): Promise<FileCandidate | null> {
    const client = getWebdavClient();

    // 1. Pre-compute the Episode Regex ONCE. 
    // This saves creating thousands of RegExp objects during the file scan.
    let episodeRegex: RegExp | null = null;
    if (requestedEpisode?.season && requestedEpisode?.episode) {
        const { season, episode } = requestedEpisode;
        // Optimized pattern: S01E01, S1E1, S01.E01, 1x01
        episodeRegex = new RegExp(
            `(?:s0*${season}\\.?e0*${episode}|0*${season}x0*${episode})(?![0-9])`,
            "i"
        );
    }

    const rootPath = normalizeNzbdavPath(`/content/${category}/${jobName}`);

    // We use a simple object structure to avoid class overhead
    const queue = [{ path: rootPath, depth: 0 }];
    const processing = new Set<Promise<void>>();
    const visited = new Set<string>();

    // Shared state
    let bestMatch: FileCandidate | null = null;
    let bestEpisodeMatch: FileCandidate | null = null;

    // Helper to process a single directory
    const processDirectory = async (currentPath: string, depth: number) => {
        // Early exit if deeply nested or already visited
        if (depth > NZBDAV_MAX_DIRECTORY_DEPTH || visited.has(currentPath)) return;
        visited.add(currentPath);

        try {
            const entries = await client.getDirectoryContents(currentPath);

            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                // Manual path concatenation is faster than calling a normalization function repeatedly
                // We assume currentPath does not have a trailing slash (controlled by our logic)
                const fullEntryPath = currentPath + "/" + entry.name;

                if (entry.isDirectory) {
                    queue.push({ path: fullEntryPath, depth: depth + 1 });
                    continue;
                }

                // Fast fail: Check extension first (fast string/regex check) before logic
                if (!entry.size || !VIDEO_EXT_REGEX.test(entry.name)) continue;

                // Use the pre-compiled regex
                // If no episode requested, everything matches (true)
                const matchesEpisode = episodeRegex ? episodeRegex.test(entry.name) : true;

                // Only build the candidate object if necessary
                const size = typeof entry.size === 'string' ? parseInt(entry.size, 10) : entry.size;

                // Inline candidate update logic to avoid object creation overhead
                if (matchesEpisode) {
                    if (!bestEpisodeMatch || size > bestEpisodeMatch.size) {
                        bestEpisodeMatch = {
                            name: entry.name,
                            size: size,
                            matchesEpisode: true,
                            absolutePath: fullEntryPath,
                            viewPath: fullEntryPath.substring(1), // Faster than replace(/^\/+/, "")
                        };
                    }
                }

                // Track global largest file (fallback)
                if (!bestMatch || size > bestMatch.size) {
                    bestMatch = {
                        name: entry.name,
                        size: size,
                        matchesEpisode, // matchesEpisode might be false here
                        absolutePath: fullEntryPath,
                        viewPath: fullEntryPath.substring(1),
                    };
                }
            }
        } catch (e) {
            // Silent fail for navigation errors
            // console.warn(`Failed to list ${currentPath}`, e);
        }
    };

    // 2. Concurrency Loop
    // Keeps a specific number of requests active at once
    while (queue.length > 0 || processing.size > 0) {

        // Fill the pool
        while (queue.length > 0 && processing.size < MAX_CONCURRENT_REQUESTS) {
            const next = queue.pop(); // .pop() (DFS) is O(1), .shift() (BFS) is O(n)
            if (!next) break;

            // Create promise
            const task = processDirectory(next.path, next.depth).then(() => {
                // Remove self from processing set when done
                processing.delete(task);
            });

            processing.add(task);
        }

        // Wait for at least one to finish before looping again to refill
        if (processing.size > 0) {
            await Promise.race(processing);
        }
    }

    return bestEpisodeMatch || bestMatch || null;
}
