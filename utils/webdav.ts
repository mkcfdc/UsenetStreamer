import {
    NZBDAV_WEBDAV_USER,
    NZBDAV_WEBDAV_PASS,
    NZBDAV_WEBDAV_URL,
    NZBDAV_WEBDAV_ROOT,
} from "../env.ts";
import { DOMParser, Element } from "@b-fuze/deno-dom";
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
            const remoteURL = getRemoteURL();
            const cleanPath = directory.replace(/^\/+/, "").replace(/\/+$/, "");
            const url = cleanPath ? `${remoteURL}/${cleanPath}` : remoteURL;

            if (directoryCache.has(url)) {
                console.log(`[WebDAV] Cache HIT for ${url}`);
                return directoryCache.get(url)!;
            }

            console.log(`[WebDAV] PROPFIND ${url}`);

            try {
                const res = await fetch(url, {
                    method: "PROPFIND",
                    headers: {
                        "Authorization": getAuthHeader(),
                        "Depth": "1",
                    },
                });

                if (!res.ok) {
                    console.error(`[WebDAV] HTTP Error fetching ${url}: ${res.status} ${res.statusText}`);
                    return [];
                }

                const xml = await res.text();
                const doc = new DOMParser().parseFromString(xml, "text/xml");
                const entries: WebdavEntry[] = [];
                const responses = doc.querySelectorAll("response, d\\:response");

                for (const resp of responses) {
                    const hrefRaw = resp.querySelector("href, d\\:href")?.textContent;
                    if (!hrefRaw) continue;

                    const propstats = resp.querySelectorAll("propstat, d\\:propstat");
                    let successfulProp: Element | null = null;
                    for (const ps of propstats) {
                        if (ps.querySelector("status, d\\:status")?.textContent?.includes("200")) {
                            successfulProp = ps.querySelector("prop, d\\:prop");
                            break;
                        }
                    }
                    if (!successfulProp) continue;

                    const href = decodeURIComponent(hrefRaw);
                    entries.push({
                        name: href.replace(/\/+$/, "").split("/").pop() || "",
                        href,
                        isDirectory: !!successfulProp.querySelector("resourcetyp, d\\:resourcetype")?.querySelector("collection, d\\:collection"),
                        size: Number(successfulProp.querySelector("getcontentlength, d\\:getcontentlength")?.textContent) || null,
                        type: successfulProp.querySelector("getcontenttype, d\\:getcontenttype")?.textContent || null,
                        lastModified: successfulProp.querySelector("getlastmodified, d\\:getlastmodified")?.textContent || null,
                    });
                }

                const requestPath = new URL(url).pathname.replace(/\/+$/, "");
                const finalEntries = entries.filter(e => decodeURIComponent(e.href.replace(/\/+$/, "")) !== decodeURIComponent(requestPath));
                directoryCache.set(url, finalEntries);

                return finalEntries;
            } catch (error) {
                console.error(`[WebDAV] Network error fetching ${url}:`, error);
                return [];
            }
        },
    };

    return client;
}

export function normalizeNzbdavPath(path: string): string {
    return (
        "/" +
        path
            .replace(/\\/g, "/")
            .replace(/\/\/+/g, "/")
            .replace(/^\/+/, "")
            .replace(/\/+$/, "")
    );
}
