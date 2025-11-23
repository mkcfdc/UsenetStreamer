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
    // 1. Check local STRM files first (Fastest)
    if (USE_STRM_FILES) {
        const strmCandidate = await findStrmCandidate(params);
        if (strmCandidate) return strmCandidate;
    }

    // 2. Scan WebDAV (One-shot)
    try {
        return await findWebdavCandidate(params);
    } catch (e: any) {
        // If the root folder itself is missing (404), treat it as "No File Found"
        // This ensures we Fast Fail back to the downloader logic
        if (e.message?.includes("404") || e.status === 404) {
            return null;
        }
        throw e; // Real network errors should still throw
    }
}

async function findStrmCandidate({ category, jobName }: FindFileParams): Promise<FileCandidate | null> {
    const safeJobName = jobName.replace(/^\/|\/$/g, "");
    const strmDir = `/strm/content/${category}/${safeJobName}`;

    try {
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

                const urlObj = new URL(urlStr);
                const rawPath = urlObj.searchParams.get("path") || urlObj.pathname.replace("/webdav", "");
                const publicBaseUrl = NZBDAV_URL.replace(/\/sabnzbd\/?$/, "").replace(/\/$/, "");
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
        episodeRegex = new RegExp(
            `(?:s0*${season}[. ]?e0*${episode}|0*${season}x0*${episode})(?![0-9])`,
            "i"
        );
    }

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
                const separator = currentPath.endsWith("/") ? "" : "/";
                const fullEntryPath = `${currentPath}${separator}${entry.name}`;

                if (entry.isDirectory) {
                    queue.push({ path: fullEntryPath, depth: depth + 1 });
                    continue;
                }

                if (!entry.size || !VIDEO_EXT_REGEX.test(entry.name)) continue;

                const size = typeof entry.size === 'string' ? parseInt(entry.size, 10) : entry.size;
                const isSample = entry.name.toLowerCase().includes("sample") && size < 50 * 1024 * 1024;
                if (isSample) continue;

                const matchesEpisode = episodeRegex ? episodeRegex.test(entry.name) : true;

                const candidate: FileCandidate = {
                    name: entry.name,
                    size: size,
                    matchesEpisode,
                    absolutePath: fullEntryPath,
                    viewPath: fullEntryPath.startsWith("/") ? fullEntryPath.substring(1) : fullEntryPath,
                };

                if (matchesEpisode) {
                    if (!bestEpisodeMatch || size > bestEpisodeMatch.size) {
                        bestEpisodeMatch = candidate;
                    }
                } else {
                    if (!bestMatch || size > bestMatch.size) {
                        bestMatch = candidate;
                    }
                }
            }
        } catch (e: any) {
            // Critical: If root folder missing, propagate error to fast-fail catch block
            if (depth === 0) throw e;
        }
    };

    while (queue.length > 0 || processing.size > 0) {
        while (queue.length > 0 && processing.size < MAX_CONCURRENT_REQUESTS) {
            const next = queue.shift();
            if (!next) break;

            const task = processDirectory(next.path, next.depth)
                .then(() => { processing.delete(task); })
                .catch((e) => {
                    processing.delete(task);
                    if (next.depth === 0) throw e; // Stop concurrency if root fails
                });

            processing.add(task);
        }

        if (processing.size > 0) {
            try {
                await Promise.race(processing);
            } catch (e) {
                throw e; // Re-throw root errors
            }
        }
    }

    return bestEpisodeMatch || bestMatch || null;
}
