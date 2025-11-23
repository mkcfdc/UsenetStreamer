// deno-lint-ignore-file no-explicit-any
import {
    NZBDAV_WEBDAV_USER,
    NZBDAV_WEBDAV_PASS,
    NZBDAV_WEBDAV_URL,
    NZBDAV_WEBDAV_ROOT,
} from "../env.ts";
import { parse } from "@libs/xml/parse";
import { LRUCache } from "lru-cache";

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

// 1. Pre-calculate static values once
const AUTH_HEADER = "Basic " + btoa(`${NZBDAV_WEBDAV_USER}:${NZBDAV_WEBDAV_PASS}`);

const REMOTE_BASE = NZBDAV_WEBDAV_URL.replace(/\/+$/, "");
const ROOT_PATH = (NZBDAV_WEBDAV_ROOT || "").replace(/^\/+/, "").replace(/\/+$/, "");
const REMOTE_ROOT_URL = ROOT_PATH ? `${REMOTE_BASE}/${ROOT_PATH}` : REMOTE_BASE;

// 2. Pre-compile Regexes (Huge performance gain over creating new RegExp in loops)
// Matches <d:response>...</d:response> or <response>...</response>
const RX_RESPONSE = /<([a-zA-Z0-9_]+:)?response(?:[\s\S]*?)>([\s\S]*?)<\/\1?response>/gi;
// Matches <d:href>...</d:href>
const RX_HREF = /<([a-zA-Z0-9_]+:)?href[^>]*>([^<]+)<\/\1?href>/i;
// Matches <d:getcontentlength>...</d:getcontentlength>
const RX_LENGTH = /<([a-zA-Z0-9_]+:)?getcontentlength[^>]*>(\d+)<\/\1?getcontentlength>/i;
// Matches <d:getlastmodified>...</d:getlastmodified>
const RX_MODIFIED = /<([a-zA-Z0-9_]+:)?getlastmodified[^>]*>([^<]+)<\/\1?getlastmodified>/i;
// Matches <d:getcontenttype>...</d:getcontenttype>
const RX_TYPE = /<([a-zA-Z0-9_]+:)?getcontenttype[^>]*>([^<]+)<\/\1?getcontenttype>/i;
// Checks for <collection/> inside resourcetype
const RX_IS_COLLECTION = /<([a-zA-Z0-9_]+:)?resourcetype[^>]*>[\s\S]*?<([a-zA-Z0-9_]+:)?collection\/>/i;

let client: WebdavClient | null = null;
const directoryCache = new LRUCache<string, WebdavEntry[]>({ max: 50 });

function getAuthHeader(): string {
    return "Basic " + btoa(`${NZBDAV_WEBDAV_USER}:${NZBDAV_WEBDAV_PASS}`);
}

function getRemoteURL(): string {
    const base = NZBDAV_WEBDAV_URL.replace(/\/+$/, "");
    const root = (NZBDAV_WEBDAV_ROOT || "")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
    return root ? `${base}/${root}` : base;
}

export function getWebdavClient(): WebdavClient {
    if (client) return client;

    client = {
        getDirectoryContents: async (directory: string) => {
            const cleanPath = directory.replace(/^\/+/, "").replace(/\/+$/, "");
            const url = cleanPath ? `${REMOTE_ROOT_URL}/${cleanPath}` : REMOTE_ROOT_URL;
            const url = cleanPath ? `${remoteURL}/${cleanPath}` : remoteURL;

            if (directoryCache.has(url)) {
                console.log(`[WebDAV] Cache HIT for ${url}`);
                return directoryCache.get(url)!;
            }

            console.log(`[WebDAV] PROPFIND ${url}`);

            const res = await fetch(url, {
                method: "PROPFIND",
                headers: {
                    "Authorization": AUTH_HEADER,
                    "Depth": "1",
                },
            });

            if (!res.ok && res.status !== 207) {
                // Consume body to free resources before throwing
                await res.text();
                throw new Error(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`);
            }
            try {
                const res = await fetch(url, {
                    method: "PROPFIND",
                    headers: { "Authorization": getAuthHeader(), "Depth": "1" },
                });

                if (!res.ok) {
                    console.error(`[WebDAV] HTTP Error fetching ${url}: ${res.status} ${res.statusText}`);
                    return [];
                }

                const xml = await res.text();
                const doc = parse(xml) as any;
                const entries: WebdavEntry[] = [];

                // Reset regex index for reuse
                RX_RESPONSE.lastIndex = 0;

                let respMatch;
                while ((respMatch = RX_RESPONSE.exec(xml)) !== null) {
                    const responseBody = respMatch[2];

                    // Fast fail: Must contain "200 OK" (faster than parsing propstat blocks)
                    // Most WebDAV servers return 200 OK for properties found.
                    if (responseBody.indexOf("HTTP/1.1 200") === -1) {
                        continue;
                    }

                    // Extract Href
                    const hrefMatch = responseBody.match(RX_HREF);
                    if (!hrefMatch) continue;

                    // Decode once
                    const href = decodeURIComponent(hrefMatch[2]);

                    // Check Collection
                    // We scan the whole block for the collection tag inside resourcetype
                    const isDirectory = RX_IS_COLLECTION.test(responseBody);

                    // Size
                    const sizeMatch = responseBody.match(RX_LENGTH);
                    const size = sizeMatch ? parseInt(sizeMatch[2], 10) : null;

                    // Type
                    const typeMatch = responseBody.match(RX_TYPE);
                    const type = typeMatch ? typeMatch[2] : null;

                    // Last Modified
                    const modMatch = responseBody.match(RX_MODIFIED);
                    const lastModified = modMatch ? modMatch[2] : null;

                    // Extract name safely
                    // Remove trailing slash, split by slash, take last segment
                    const name = href.endsWith('/')
                        ? href.slice(0, -1).split('/').pop() || ""
                        : href.split('/').pop() || "";

                    entries.push({
                        name,
                        href,
                        isDirectory,
                        size,
                        type,
                        lastModified
                    });
                }

                const requestPath = new URL(url).pathname.replace(/\/+$/, "");
                const decodedRequestPath = decodeURIComponent(requestPath);

                return entries.filter(e => {
                    const entryPath = e.href.replace(/\/+$/, "");
                    return entryPath !== decodedRequestPath;
                });
                const responses = doc.multistatus?.response;
                if (!responses) return [];

                const responseArray = Array.isArray(responses) ? responses : [responses];

                for (const resp of responseArray) {
                    if (!resp) continue;

                    const hrefRaw = resp.href;
                    if (typeof hrefRaw !== "string") continue;

                    const propstats: { status?: string; prop?: any }[] = Array.isArray(resp.propstat) ? resp.propstat : [resp.propstat];
                    const successfulPropstat = propstats.find(ps => typeof ps?.status === "string" && ps.status.includes("200"));

                    if (!successfulPropstat?.prop) continue;

                    const prop = successfulPropstat.prop;
                    const resourcetype = prop.resourcetype;

                    const href = decodeURIComponent(hrefRaw);
                    entries.push({
                        name: href.replace(/\/+$/, "").split("/").pop() || "",
                        href,
                        isDirectory: !!resourcetype && typeof resourcetype === 'object' && 'collection' in resourcetype,
                        size: Number(prop.getcontentlength) || null,
                        type: prop.getcontenttype || null,
                        lastModified: prop.getlastmodified || null,
                    });
                }

                const requestPath = new URL(url).pathname.replace(/\/+$/, "");
                const finalEntries = entries.filter(e => decodeURIComponent(e.href.replace(/\/+$/, "")) !== decodeURIComponent(requestPath));
                directoryCache.set(url, finalEntries);

                return finalEntries;

            } catch (error) {
                console.error(`[WebDAV] Network or parsing error fetching ${url}:`, error);
                return [];
            }
        },
    };

    return client;
}

export function normalizeNzbdavPath(path: string): string {
    // Using a single regex pass for multiple slashes is slightly faster
    // but the main optimization is ensuring we don't create intermediate strings unnecessarily
    if (!path) return "/";
    const normalized = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    if (normalized === "/") return normalized;

    // Manual trimming is often faster than Regex for start/end chars
    let start = 0;
    let end = normalized.length;

    if (normalized.charCodeAt(0) === 47) start = 1; // 47 is '/'
    if (normalized.charCodeAt(end - 1) === 47) end--;

    return "/" + normalized.substring(start, end);
}
