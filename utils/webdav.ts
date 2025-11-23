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
                    headers: { "Authorization": getAuthHeader(), "Depth": "1" },
                });

                if (!res.ok) {
                    console.error(`[WebDAV] HTTP Error fetching ${url}: ${res.status} ${res.statusText}`);
                    return [];
                }

                const xml = await res.text();
                const doc = parse(xml) as any;
                const entries: WebdavEntry[] = [];

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
