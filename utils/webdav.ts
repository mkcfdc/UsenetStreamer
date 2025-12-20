import { Config } from "../env.ts";

export type WebdavEntry = {
    name: string;
    href: string;
    isDirectory: boolean;
    size: number | null;
    type: string | null;
    lastModified: string | null;
};

export type WebdavClient = {
    getDirectoryContents: (directory: string) => Promise<WebdavEntry[]>;
};

const AUTH_HEADER = "Basic " + btoa(`${Config.NZBDAV_WEBDAV_USER}:${Config.NZBDAV_WEBDAV_PASS}`);

const REMOTE_BASE = Config.NZBDAV_WEBDAV_URL.replace(/\/+$/, "");
const ROOT_PATH = (Config.NZBDAV_WEBDAV_ROOT || "").replace(/(^\/+|\/+$)/g, "");
const REMOTE_ROOT_URL = ROOT_PATH ? `${REMOTE_BASE}/${ROOT_PATH}` : REMOTE_BASE;

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
    <D:getcontentlength/>
    <D:getlastmodified/>
    <D:getcontenttype/>
  </D:prop>
</D:propfind>`;

// Reusable headers object - avoid recreating on every request
const PROPFIND_HEADERS = {
    "Authorization": AUTH_HEADER,
    "Depth": "1",
    "Content-Type": "application/xml",
} as const;

// Case-insensitive pattern for collection detection
const COLLECTION_PATTERN = /<[dD]:collection\s*\/>/;

let client: WebdavClient | null = null;

const httpClient = Deno.createHttpClient({
    poolIdleTimeout: 60_000,
    poolMaxIdlePerHost: 50,
    http2: true,
});

function safeDecodeURIComponent(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

function extractTagValue(xml: string, tagName: string): string | null {
    // Matches both D: and d: prefixes
    const pattern = new RegExp(`<[dD]:${tagName}>([^<]*)<`, "i");
    const match = pattern.exec(xml);
    return match?.[1] ?? null;
}

function parseSize(sizeStr: string | null): number | null {
    if (!sizeStr) return null;
    const n = parseInt(sizeStr, 10);
    return Number.isFinite(n) ? n : null;
}

function extractNameFromHref(href: string): string {
    const decodedHref = safeDecodeURIComponent(href);
    const trimmed = decodedHref.endsWith("/")
        ? decodedHref.slice(0, -1)
        : decodedHref;
    return trimmed.split("/").pop() || "";
}

function isSelfEntry(href: string, targetPathEncoded: string): boolean {
    if (!targetPathEncoded) return false;

    const hrefTrimmed = href.endsWith("/") ? href.slice(0, -1) : href;
    if (!hrefTrimmed.endsWith(targetPathEncoded)) return false;

    const sepIdx = hrefTrimmed.length - targetPathEncoded.length - 1;
    return sepIdx < 0 || hrefTrimmed[sepIdx] === "/";
}

function parseResponseBlock(block: string, targetPathEncoded: string): WebdavEntry | null {
    // Skip non-200 responses
    if (!block.includes("200 OK") && !block.includes(" 200 ")) return null;

    const href = extractTagValue(block, "href");
    if (!href) return null;

    // Skip self-referential entries
    if (isSelfEntry(href, targetPathEncoded)) return null;

    const isDirectory = COLLECTION_PATTERN.test(block);
    const decodedHref = safeDecodeURIComponent(href);

    return {
        name: extractNameFromHref(href),
        href: decodedHref,
        isDirectory,
        size: isDirectory ? null : parseSize(extractTagValue(block, "getcontentlength")),
        type: extractTagValue(block, "getcontenttype"),
        lastModified: extractTagValue(block, "getlastmodified"),
    };
}

function parseWebdavXml(xml: string, targetPathEncoded: string): WebdavEntry[] {
    const entries: WebdavEntry[] = [];
    const xmlLen = xml.length;
    let pos = 0;

    while (pos < xmlLen) {
        const startIdx = xml.indexOf("response>", pos);
        if (startIdx === -1) break;

        const openTag = xml.lastIndexOf("<", startIdx);
        if (openTag === -1) {
            pos = startIdx + 9;
            continue;
        }

        const gt = xml.indexOf(">", openTag);
        if (gt === -1) break;

        const tagName = xml.substring(openTag + 1, gt).trim();
        const closeTag = `</${tagName}>`;

        const endIdx = xml.indexOf(closeTag, gt);
        if (endIdx === -1) {
            pos = gt + 1;
            continue;
        }

        pos = endIdx + closeTag.length;

        const block = xml.substring(openTag, endIdx);
        const entry = parseResponseBlock(block, targetPathEncoded);
        if (entry) entries.push(entry);
    }

    return entries;
}

export function getWebdavClient(): WebdavClient {
    if (client) return client;

    client = {
        getDirectoryContents: async (directory: string): Promise<WebdavEntry[]> => {
            const cleanPath = directory.replace(/(^\/+|\/+$)/g, "");
            const url = cleanPath ? `${REMOTE_ROOT_URL}/${cleanPath}` : REMOTE_ROOT_URL;

            const targetPathEncoded = cleanPath
                ? cleanPath.split("/").map(encodeURIComponent).join("/")
                : "";

            const res = await fetch(url, {
                method: "PROPFIND",
                client: httpClient,
                headers: PROPFIND_HEADERS,
                body: PROPFIND_BODY,
            });

            if (res.status !== 207) {
                // Read limited response body for error context
                let errorDetail = "";
                try {
                    const text = await res.text();
                    errorDetail = text.length > 200 ? text.slice(0, 200) : text;
                } catch {
                    // ignore read errors
                }
                throw new Error(
                    `WebDAV PROPFIND failed: ${res.status} ${res.statusText} - ${errorDetail}`,
                );
            }

            const xml = await res.text();
            return parseWebdavXml(xml, targetPathEncoded);
        },
    };

    return client;
}

export function normalizeNzbdavPath(path: string): string {
    if (!path || path === "/") return "/";

    const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
    if (normalized === "/") return "/";

    const start = normalized[0] === "/" ? 1 : 0;
    const end = normalized[normalized.length - 1] === "/" ? normalized.length - 1 : normalized.length;

    return "/" + normalized.substring(start, end);
}
