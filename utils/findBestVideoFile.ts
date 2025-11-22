import { extname } from "@std/path/posix";
import { normalizeNzbdavPath, getWebdavClient, type WebdavEntry } from "./webdav.ts";
import { NZBDAV_MAX_DIRECTORY_DEPTH, NZBDAV_URL, NZBDAV_VIDEO_EXTENSIONS, USE_STRM_FILES } from "../env.ts";

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

/**
 * Strategy 2: WebDAV Directory Traversal
 * Recursively searches WebDAV for the largest matching video file.
 */
async function findWebdavCandidate({ category, jobName, requestedEpisode }: FindFileParams): Promise<FileCandidate | null> {
    const rootPath = normalizeNzbdavPath(`/content/${category}/${jobName}`);
    const queue = [{ path: rootPath, depth: 0 }];
    const visited = new Set<string>();

    let bestMatch: FileCandidate | null = null;
    let bestEpisodeMatch: FileCandidate | null = null;

    while (queue.length > 0) {
        const { path: currentPath, depth } = queue.shift()!;

        if (depth > NZBDAV_MAX_DIRECTORY_DEPTH || visited.has(currentPath)) continue;
        visited.add(currentPath);

        let entries: WebdavEntry[];
        try {
            const client = getWebdavClient();
            entries = await client.getDirectoryContents(currentPath);
        } catch {
            // Silent fail for navigation errors, just skip this path
            continue;
        }

        for (const entry of entries) {
            if (!entry.name) continue;

            const fullEntryPath = normalizeNzbdavPath(`${currentPath}/${entry.name}`);

            if (entry.isDirectory) {
                queue.push({ path: fullEntryPath + "/", depth: depth + 1 });
                continue;
            }

            // Skip non-video files or files with no size
            if (!entry.size || !isVideoFileName(entry.name)) continue;

            const matchesEpisode = fileMatchesEpisode(entry.name, requestedEpisode);

            const candidate: FileCandidate = {
                name: entry.name,
                size: typeof entry.size === 'string' ? parseInt(entry.size) : entry.size,
                matchesEpisode,
                absolutePath: fullEntryPath,
                viewPath: fullEntryPath.replace(/^\/+/, ""), // Remove leading slashes for view path
            };

            if (matchesEpisode) {
                if (!bestEpisodeMatch || candidate.size > bestEpisodeMatch.size) {
                    bestEpisodeMatch = candidate;
                }
            }

            // Track overall largest file just in case
            if (!bestMatch || candidate.size > bestMatch.size) {
                bestMatch = candidate;
            }
        }
    }

    return bestEpisodeMatch || bestMatch || null;
}

// --- Helpers ---

function isVideoFileName(fileName: string): boolean {
    const ext = extname(fileName).toLowerCase();
    return NZBDAV_VIDEO_EXTENSIONS.has(ext);
}

function fileMatchesEpisode(fileName: string, requestedEpisode?: EpisodeInfo): boolean {
    if (!requestedEpisode || !requestedEpisode.season || !requestedEpisode.episode) {
        return true; // No specific episode requested, so it "matches"
    }

    const { season, episode } = requestedEpisode;

    // Regex patterns for common naming conventions
    const patterns = [
        new RegExp(`s0*${season}e0*${episode}(?![0-9])`, "i"),       // S01E01
        new RegExp(`s0*${season}\\.?e0*${episode}(?![0-9])`, "i"),   // S01.E01
        new RegExp(`0*${season}[xX]0*${episode}(?![0-9])`, "i"),     // 1x01
        new RegExp(`[eE](?:pisode|p)\\.?\\s*0*${episode}(?![0-9])`, "i"), // Ep 01
    ];

    return patterns.some((regex) => regex.test(fileName));
}
