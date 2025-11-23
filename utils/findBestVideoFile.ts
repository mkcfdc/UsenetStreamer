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
const MAX_CONCURRENT_REQUESTS = 5;

export async function findBestVideoFile(params: FindFileParams): Promise<FileCandidate | null> {
    // 1. Check local STRM files first (Fastest, no WebDAV overhead)
    if (USE_STRM_FILES) {
        const strmCandidate = await findStrmCandidate(params);
        if (strmCandidate) return strmCandidate;
    }

    // 2. Scan WebDAV with Retries
    // Filesystem latency (moving from tmp -> final) is the #1 cause of "File not found"
    // We try 3 times with increasing delays.
    for (let i = 0; i < 3; i++) {
        try {
            const candidate = await findWebdavCandidate(params);
            if (candidate) return candidate;
        } catch (e) {
            console.warn(`[FindFile] Attempt ${i + 1} error:`, e);
        }

        if (i < 2) {
            const delay = (i + 1) * 1000; // 1s, then 2s
            console.log(`[FindFile] File not found yet. Retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    return null;
}

async function findStrmCandidate({ category, jobName }: FindFileParams): Promise<FileCandidate | null> {
    // Ensure we don't end up with double slashes if jobName is empty or malformed
    const safeJobName = jobName.replace(/^\/|\/$/g, "");
    const strmDir = `/strm/content/${category}/${safeJobName}`;

    try {
        // Quick existence check
        await Deno.stat(strmDir);
    } catch {
        return null;
    }

    console.log(`[STRM] Scanning: ${strmDir}`);

    try {
        for await (const entry of Deno.readDir(strmDir)) {
            if (!entry.isFile || !entry.name.toLowerCase().endsWith(".strm")) continue;

            const strmFilePath = `${strmDir}/${entry.name}`;

            try {
                const content = await Deno.readTextFile(strmFilePath);
                const urlStr = content.trim();
                if (!urlStr) continue;

                // Extract the internal path from the stored URL
                // Format usually: http://host:port/webdav/path/to/file.mkv
                const urlObj = new URL(urlStr);

                // If using standard strm generation, the path is often in the path part or a query param
                // Adjust this logic to match how you generate STRMs
                const rawPath = urlObj.searchParams.get("path") || urlObj.pathname.replace("/webdav", "");

                // Dynamic URL replacement ensures it works even if container networking changes
                const publicBaseUrl = NZBDAV_URL.replace(/\/sabnzbd\/?$/, "").replace(/\/$/, "");
                // Reconstruct view path based on current environment
                const viewPath = urlStr.replace(/^https?:\/\/[^/]+/, publicBaseUrl);

                return {
                    viewPath,
                    absolutePath: rawPath,
                    name: entry.name.replace(".strm", ""),
                    size: 0,
                    matchesEpisode: true,
                };
            } catch (e) {
                console.warn(`[STRM] Read error ${entry.name}:`, e);
            }
        }
    } catch (e) {
        console.warn(`[STRM] Directory read error:`, e);
    }

    return null;
}

export async function findWebdavCandidate({ category, jobName, requestedEpisode }: FindFileParams): Promise<FileCandidate | null> {
    const client = getWebdavClient();

    // Normalize root path. Ensure no trailing slash for consistency.
    const rootPath = normalizeNzbdavPath(`/content/${category}/${jobName}`).replace(/\/$/, "");

    let episodeRegex: RegExp | null = null;
    if (requestedEpisode?.season && requestedEpisode?.episode) {
        const { season, episode } = requestedEpisode;
        // Strict S01E01 or 1x01 matching to avoid false positives
        episodeRegex = new RegExp(
            `(?:s0*${season}[. ]?e0*${episode}|0*${season}x0*${episode})(?![0-9])`,
            "i"
        );
    }

    // Switch to BFS (Breadth-First Search) using shift() instead of pop().
    // We want to find the main file in the root folder BEFORE digging into "Samples", "Subs", etc.
    const queue = [{ path: rootPath, depth: 0 }];
    const processing = new Set<Promise<void>>();
    const visited = new Set<string>();

    let bestMatch: FileCandidate | null = null;
    let bestEpisodeMatch: FileCandidate | null = null;

    const processDirectory = async (currentPath: string, depth: number) => {
        if (depth > NZBDAV_MAX_DIRECTORY_DEPTH || visited.has(currentPath)) return;
        visited.add(currentPath);

        try {
            const entries = await client.getDirectoryContents(currentPath);

            for (const entry of entries) {
                // Safer path concatenation
                const separator = currentPath.endsWith("/") ? "" : "/";
                const fullEntryPath = `${currentPath}${separator}${entry.name}`;

                if (entry.isDirectory) {
                    // Add to queue for BFS processing
                    queue.push({ path: fullEntryPath, depth: depth + 1 });
                    continue;
                }

                // 1. Extension Check
                if (!entry.size || !VIDEO_EXT_REGEX.test(entry.name)) continue;

                // 2. Sample Check (Skip small sample files)
                // Filter out files < 50MB typically, unless it's the only thing there
                const size = typeof entry.size === 'string' ? parseInt(entry.size, 10) : entry.size;
                const isSample = entry.name.toLowerCase().includes("sample") && size < 100 * 1024 * 1024;
                if (isSample) continue;

                const matchesEpisode = episodeRegex ? episodeRegex.test(entry.name) : true;

                // 3. Candidate Selection
                const candidate: FileCandidate = {
                    name: entry.name,
                    size: size,
                    matchesEpisode,
                    absolutePath: fullEntryPath,
                    // Remove leading slash for viewPath if necessary
                    viewPath: fullEntryPath.startsWith("/") ? fullEntryPath.substring(1) : fullEntryPath,
                };

                // Priority Logic:
                if (matchesEpisode) {
                    // If we have an episode match, verify it's the largest one (avoiding duplicates)
                    if (!bestEpisodeMatch || size > bestEpisodeMatch.size) {
                        bestEpisodeMatch = candidate;
                    }
                } else {
                    // Fallback: Largest video file found generally
                    if (!bestMatch || size > bestMatch.size) {
                        bestMatch = candidate;
                    }
                }
            }
        } catch (e: any) {
            // Log root failures, ignore deep folder failures
            if (depth === 0) {
                console.warn(`[WebDAV] Root access failed: ${currentPath} (${e.message || e})`);
                // If the root folder doesn't exist (404), this is critical info
                throw e;
            }
        }
    };

    // Concurrency Loop
    while (queue.length > 0 || processing.size > 0) {
        while (queue.length > 0 && processing.size < MAX_CONCURRENT_REQUESTS) {
            const next = queue.shift(); // BFS: Process oldest item first (Top level)
            if (!next) break;

            const task = processDirectory(next.path, next.depth)
                .then(() => { processing.delete(task); })
                .catch(() => { processing.delete(task); }); // Safety catch

            processing.add(task);
        }

        if (processing.size > 0) {
            await Promise.race(processing);
        }
    }

    return bestEpisodeMatch || bestMatch || null;
}
