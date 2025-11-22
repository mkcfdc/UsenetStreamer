import { XMLParser } from "fast-xml-parser";
import {
    NZBDAV_WEBDAV_USER,
    NZBDAV_WEBDAV_PASS,
    NZBDAV_WEBDAV_URL,
    NZBDAV_WEBDAV_ROOT,
} from "../env.ts";

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

// Types for the raw XML structure after parsing
type XmlPropStat = {
    status: string;
    prop?: {
        resourcetype?: { collection?: string } | string;
        getcontentlength?: number;
        getcontenttype?: string;
        getlastmodified?: string;
    };
};

type XmlResponse = {
    href: string;
    propstat: XmlPropStat | XmlPropStat[];
};

type XmlResult = {
    multistatus?: {
        response?: XmlResponse | XmlResponse[];
    };
};

export function getWebdavClient(): WebdavClient {
    if (client) return client;

    // Configure parser to remove namespaces (d:href -> href) and force arrays for list items
    interface ParserOptions {
        removeNSPrefix: boolean;
        ignoreAttributes: boolean;
        parseTagValue: boolean;
        isArray: (name: string, jpath?: string, isLeafNode?: boolean) => boolean;
    }

    const parserOptions: ParserOptions = {
        removeNSPrefix: true,
        ignoreAttributes: true,
        parseTagValue: true, // Auto-convert numbers/booleans
        isArray: (name: string) => name === "response" || name === "propstat",
    };

    const parser: XMLParser = new XMLParser(parserOptions);

    client = {
        getDirectoryContents: async (directory: string) => {
            const remoteURL = getRemoteURL();
            const cleanPath = directory.replace(/^\/+/, "").replace(/\/+$/, "");
            const url = cleanPath ? `${remoteURL}/${cleanPath}` : remoteURL;

            console.log(`[WebDAV] PROPFIND ${url}`);

            const res = await fetch(url, {
                method: "PROPFIND",
                headers: {
                    "Authorization": getAuthHeader(),
                    "Depth": "1",
                },
            });

            if (!res.ok && res.status !== 207) {
                await res.text(); // consume body
                throw new Error(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`);
            }

            const xml = await res.text();

            // Parse XML to JSON Object
            const result = parser.parse(xml) as XmlResult;

            // Safely access the response array
            const responses = result.multistatus?.response;

            if (!responses) return [];

            // Ensure it is an array (handles single file case)
            const responseList = Array.isArray(responses) ? responses : [responses];
            const entries: WebdavEntry[] = [];

            for (const resp of responseList) {
                const href = decodeURIComponent(resp.href || "");

                // Normalize propstat to array
                const propstats = Array.isArray(resp.propstat) ? resp.propstat : [resp.propstat];

                let isDirectory = false;
                let size: number | null = null;
                let contentType: string | null = null;
                let lastModified: string | null = null;
                let statusOk = false;

                for (const ps of propstats) {
                    // Check strictly for 200 OK (WebDAV often returns 404 propstats mixed in)
                    if (!ps.status || !ps.status.includes("200")) continue;

                    statusOk = true;
                    const prop = ps.prop;
                    if (!prop) continue;

                    // Check resource type
                    if (prop.resourcetype) {
                        // Empty tag <resourcetype/> means file, <resourcetype><collection/></resourcetype> means folder
                        // fast-xml-parser usually treats empty tag as empty string, or checks existence of key inside
                        if (typeof prop.resourcetype === 'object' && 'collection' in prop.resourcetype) {
                            isDirectory = true;
                        }
                    }

                    if (prop.getcontentlength !== undefined) {
                        size = Number(prop.getcontentlength);
                    }

                    if (prop.getcontenttype) {
                        contentType = String(prop.getcontenttype);
                    }

                    if (prop.getlastmodified) {
                        lastModified = String(prop.getlastmodified);
                    }
                }

                if (!statusOk) continue;

                // Extract name
                const name = href.replace(/\/+$/, "").split("/").pop() || "";

                entries.push({
                    name,
                    href,
                    isDirectory,
                    size,
                    type: contentType,
                    lastModified
                });
            }

            const requestPath = new URL(url).pathname.replace(/\/+$/, "");

            return entries.filter(e => {
                const entryHref = e.href.replace(/\/+$/, "");
                return entryHref !== decodeURIComponent(requestPath);
            });
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
