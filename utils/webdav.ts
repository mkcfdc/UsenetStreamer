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

function webdavAuthHeader(): string {
    return "Basic " + btoa(`${Config.NZBDAV_WEBDAV_USER}:${Config.NZBDAV_WEBDAV_PASS}`);
}

function remoteRootUrl(): string {
    const remoteBase = Config.NZBDAV_WEBDAV_URL.replace(/\/+$/, "");
    const rootPath = (Config.NZBDAV_WEBDAV_ROOT || "").replace(/(^\/+|\/+$)/g, "");
    return rootPath ? `${remoteBase}/${rootPath}` : remoteBase;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
    <D:getcontentlength/>
    <D:getlastmodified/>
    <D:getcontenttype/>
  </D:prop>
</D:propfind>`;

const PROPFIND_HEADERS = {
    "Depth": "1",
    "Content-Type": "application/xml",
} as const;

const RX_RESPONSE_BLOCK = /<([dD]:)?response[\s>][\s\S]*?<\/([dD]:)?response>/gi;
const RX_COLLECTION = /<[dD]:collection\s*\/>/i;
const RX_HREF = /<[dD]:href>([^<]*)<\//i;
const RX_LEN = /<[dD]:getcontentlength>([^<]*)<\//i;
const RX_TYPE = /<[dD]:getcontenttype>([^<]*)<\//i;
const RX_MOD = /<[dD]:getlastmodified>([^<]*)<\//i;

const httpClient = Deno.createHttpClient({
    poolIdleTimeout: 60_000,
    poolMaxIdlePerHost: 50,
    http2: false,
});

function safeDecodeURIComponent(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

function extractNameFromHref(href: string): string {
    const decodedHref = safeDecodeURIComponent(href);
    const trimmed = decodedHref.endsWith("/") ? decodedHref.slice(0, -1) : decodedHref;
    const lastSlash = trimmed.lastIndexOf("/");
    return lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
}

function isSelfEntry(href: string, targetPathEncoded: string): boolean {
    if (!targetPathEncoded) return false;
    const hrefTrimmed = href.endsWith("/") ? href.slice(0, -1) : href;
    if (!hrefTrimmed.endsWith(targetPathEncoded)) return false;
    const sepIdx = hrefTrimmed.length - targetPathEncoded.length - 1;
    return sepIdx < 0 || hrefTrimmed[sepIdx] === "/";
}

function parseResponseBlock(block: string, targetPathEncoded: string): WebdavEntry | null {
    if (!block.includes("200 OK") && !block.includes(" 200 ")) return null;
    const hrefMatch = RX_HREF.exec(block);
    if (!hrefMatch) return null;
    const href = hrefMatch[1];
    if (isSelfEntry(href, targetPathEncoded)) return null;
    const isDirectory = RX_COLLECTION.test(block);
    const sizeStr = isDirectory ? null : RX_LEN.exec(block)?.[1];
    let size: number | null = null;
    if (sizeStr) {
        const parsedSize = parseInt(sizeStr, 10);
        if (Number.isFinite(parsedSize)) size = parsedSize;
    }
    return {
        name: extractNameFromHref(href),
        href: safeDecodeURIComponent(href),
        isDirectory,
        size,
        type: RX_TYPE.exec(block)?.[1] ?? null,
        lastModified: RX_MOD.exec(block)?.[1] ?? null,
    };
}

function parseWebdavXml(xml: string, targetPathEncoded: string): WebdavEntry[] {
    const entries: WebdavEntry[] = [];
    let match;
    while ((match = RX_RESPONSE_BLOCK.exec(xml)) !== null) {
        const entry = parseResponseBlock(match[0], targetPathEncoded);
        if (entry) entries.push(entry);
    }
    return entries;
}

export const webdavClient: WebdavClient = {
    getDirectoryContents: async (directory: string): Promise<WebdavEntry[]> => {
        const cleanPath = directory.replace(/(^\/+|\/+$)/g, "");
        const root = remoteRootUrl();
        const url = cleanPath ? `${root}/${cleanPath}` : root;
        const targetPathEncoded = cleanPath
            ? cleanPath.split("/").map(encodeURIComponent).join("/")
            : "";
        const res = await fetch(url, {
            method: "PROPFIND",
            client: httpClient,
            headers: {
                ...PROPFIND_HEADERS,
                Authorization: webdavAuthHeader(),
            },
            body: PROPFIND_BODY,
        });
        if (res.status !== 207) {
            let errorDetail = "";
            try {
                const text = await res.text();
                errorDetail = text.length > 200 ? text.slice(0, 200) : text;
            } catch {
                // ignore
            }
            throw new Error(`WebDAV PROPFIND failed: ${res.status} ${res.statusText} - ${errorDetail}`);
        }
        const xml = await res.text();
        return parseWebdavXml(xml, targetPathEncoded);
    },
};

export function getWebdavClient(): WebdavClient {
    return webdavClient;
}

export function normalizeNzbdavPath(path: string): string {
    if (!path || path === "/") return "/";
    const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
    if (normalized === "/") return "/";
    const start = normalized[0] === "/" ? 1 : 0;
    const end = normalized[normalized.length - 1] === "/" ? normalized.length - 1 : normalized.length;
    return "/" + normalized.substring(start, end);
}
