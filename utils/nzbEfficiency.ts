/** Pure helpers for NZB add/check/rank/structure. No SQLite, safe for unit tests. */

const DUMMY_NZBCHECK_KEYS = new Set([
    "",
    "SECURE_TRUSTED_KEY",
    "SUPER_SECURE_KEY",
    "SUPER_SECURE_KEY_NO_ONE_KNOWS",
    "CHANGE_ME",
]);

export function isNzbCheckKeyUsable(key: string | undefined | null): boolean {
    const k = (key ?? "").trim();
    if (!k) return false;
    if (DUMMY_NZBCHECK_KEYS.has(k)) return false;
    if (/^your[-_]/i.test(k)) return false;
    if (/placeholder|changeme|example/i.test(k)) return false;
    return true;
}

export function isNzbCheckEnabled(url: string | undefined | null, key: string | undefined | null): boolean {
    return Boolean((url ?? "").trim()) && isNzbCheckKeyUsable(key);
}

/** Base URL NZBDav should use to pull an NZB from this addon (Compose DNS, not LAN/HTTPS). */
export function internalAddonBaseUrl(
    explicit: string | undefined | null,
    publicBase: string | undefined | null,
    port: number,
): string {
    const fromEnv = (explicit ?? "").trim().replace(/\/$/, "");
    if (fromEnv) return fromEnv;

    const pub = (publicBase ?? "").trim();
    try {
        if (pub) {
            const u = new URL(pub);
            const host = u.hostname.toLowerCase();
            if (host === "usenetstreamer" || host === "localhost" || host === "127.0.0.1") {
                return `${u.protocol}//${u.hostname}:${u.port || port}`;
            }
        }
    } catch { /* ignore bad public URL */ }

    return `http://usenetstreamer:${port || 7000}`;
}

export function internalNzbProxyUrl(base: string, urlHash: string): string {
    return `${base.replace(/\/$/, "")}/nzb/proxy/${urlHash}.nzb`;
}

/**
 * Higher is listed first in Stremio (usually auto-picked).
 * 1080p WEB starts faster than 2160p REMUX; 4K stays on the list, just not first.
 */
export function startRank(resolution: string, sizeBytes = 0): number {
    const r = resolution.toLowerCase();
    let score = 100;
    if (r.includes("1080") || r.includes("fhd")) score = 400;
    else if (r.includes("720")) score = 280;
    else if (r.includes("2160") || r.includes("4k") || r.includes("uhd")) score = 220;
    else if (r.includes("1440") || r.includes("2k")) score = 240;

    const gb = sizeBytes / 1_000_000_000;
    if (gb > 20) score -= 80;
    else if (gb > 12) score -= 40;
    else if (gb > 8) score -= 15;
    return score;
}

const WEB_RX = /\b(web-?dl|webrip|web\b|hdtv|amazon|netflix|dsnp|hulu|atvp|amzn|nf|dsny)\b/i;
const REMUX_RX = /\b(remux|uhd[\s.\-]?bluray|complete[\s.\-]?bluray|disc\b|iso\b)\b/i;
const BLURAY_RX = /\b(bluray|blu-ray|bdrip|bd-?rip|brrip)\b/i;
const ARCHIVE_RX = /\.(rar|r\d{2}|7z|zip)\b|\brar\b/i;
const VIDEO_RX = /\.(mkv|mp4|m4v|ts|m2ts)\b/i;

/** Title-aware start score. Prefer single-file WEB 1080p over huge REMUX/RAR. */
export function releaseStartScore(resolution: string, sizeBytes = 0, title = ""): number {
    let score = startRank(resolution, sizeBytes);
    if (!title) return score;
    const t = title.toLowerCase();
    if (WEB_RX.test(t)) score += 35;
    if (REMUX_RX.test(t)) score -= 50;
    else if (BLURAY_RX.test(t)) score -= 15;
    if (ARCHIVE_RX.test(t)) score -= 60;
    if (VIDEO_RX.test(t)) score += 20;
    return score;
}

export interface NzbStructure {
    fileCount: number;
    segmentCount: number;
    videoFileCount: number;
    archiveFileCount: number;
    subjects: string[];
    likelyDirectVideo: boolean;
    likelyArchive: boolean;
    usable: boolean;
    startBonus: number;
}

const RX_FILE = /<file\b/gi;
const RX_SEGMENT = /<segment\b/gi;
const RX_SUBJECT = /\bsubject="([^"]*)"/gi;
const RX_HTML = /^\s*(<!doctype\s+html|<html[\s>])/i;
const RX_VIDEO_SUB = /\.(mkv|mp4|m4v|ts|m2ts|avi|mov|webm)(?:["'\s]|$)/i;
const RX_ARCHIVE_SUB = /\.(rar|r\d{2}|7z|zip|part\d+)(?:["'\s]|$)/i;

function countMatches(rx: RegExp, text: string): number {
    rx.lastIndex = 0;
    let n = 0;
    while (rx.exec(text)) n++;
    return n;
}

function collectSubjects(text: string, cap = 24): string[] {
    RX_SUBJECT.lastIndex = 0;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = RX_SUBJECT.exec(text)) && out.length < cap) {
        if (m[1]) out.push(m[1]);
    }
    return out;
}

/** Inspect NZB XML. Cheap scan — no DOM. */
export function parseNzbXml(xml: string): NzbStructure {
    const text = (xml ?? "").trim();
    const empty: NzbStructure = {
        fileCount: 0,
        segmentCount: 0,
        videoFileCount: 0,
        archiveFileCount: 0,
        subjects: [],
        likelyDirectVideo: false,
        likelyArchive: false,
        usable: false,
        startBonus: 0,
    };
    if (!text || RX_HTML.test(text)) return empty;
    if (!/<nzb\b/i.test(text) && !/<file\b/i.test(text)) return empty;

    const fileCount = countMatches(RX_FILE, text);
    const segmentCount = countMatches(RX_SEGMENT, text);
    const subjects = collectSubjects(text);

    let videoFileCount = 0;
    let archiveFileCount = 0;
    for (const s of subjects) {
        if (RX_ARCHIVE_SUB.test(s)) archiveFileCount++;
        else if (RX_VIDEO_SUB.test(s)) videoFileCount++;
    }

    const likelyArchive = archiveFileCount > 0;
    const likelyDirectVideo = videoFileCount > 0 && archiveFileCount === 0;
    const usable = fileCount >= 1 && segmentCount >= 1;

    let startBonus = 0;
    if (likelyDirectVideo && fileCount <= 3) startBonus += 80;
    else if (likelyDirectVideo) startBonus += 30;
    if (likelyArchive) startBonus -= 40;
    if (fileCount > 20) startBonus -= 20;

    return {
        fileCount,
        segmentCount,
        videoFileCount,
        archiveFileCount,
        subjects,
        likelyDirectVideo,
        likelyArchive,
        usable,
        startBonus,
    };
}

export function isGzipNzb(bytes: Uint8Array): boolean {
    return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Decode NZB bytes (plain XML or gzip). */
export async function decodeNzbBytes(bytes: Uint8Array): Promise<string> {
    if (isGzipNzb(bytes)) {
        const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
        return await new Response(stream).text();
    }
    return new TextDecoder("utf-8").decode(bytes);
}

export async function inspectNzbBytes(bytes: Uint8Array): Promise<NzbStructure> {
    if (bytes.byteLength < 64) {
        return parseNzbXml("");
    }
    const text = await decodeNzbBytes(bytes);
    return parseNzbXml(text);
}
