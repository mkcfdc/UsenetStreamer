/** Pure helpers for NZB add/check/rank. No SQLite, safe for unit tests. */

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
