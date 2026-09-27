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
    // Partial-file polls must keep walking. A 10s miss cache here added
    // ~10s to first-byte while the NZBDav file was already growing.
    if (cached?.viewPath) return cached;
    if (cached?.pending && !params.allowPartial) return null;

    let found: FileCandidate | null = null;

    if (Config.USE_STRM_FILES) {
        found = await findStrmCandidate(params);
    }

    if (!found) {
        try {
            found = await findWebdavCandidate(params);
        } catch (e) {
            const isNotFound = e instanceof Error
                ? e.message.includes("404")
                : typeof e === "object" && e !== null && "status" in e && e.status === 404;
            if (isNotFound) found = null;
            else throw e;
        }
    }

    if (found?.viewPath) {
        setJsonValue(cacheKey, "$", found, WEBDAV_TTL_SEC).catch(() => {});
    } else if (!params.allowPartial) {
        setJsonValue(cacheKey, "$", { pending: true }, WEBDAV_MISS_TTL_SEC).catch(() => {});
    }
    return found;
}
