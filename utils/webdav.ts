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

/**
 * Minimalistic XML helper to extract content between tags.
 * Handles namespaces (e.g. <d:href> or <D:href> or <href>)
 */
function getTagValue(xml: string, tagName: string): string | null {
    // Matches <prefix:tagName>VALUE</prefix:tagName> or <tagName>VALUE</tagName>
    // \s\S captures newlines
    const regex = new RegExp(`<([a-zA-Z0-9_]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/([a-zA-Z0-9_]+:)?${tagName}>`, "i");
    const match = xml.match(regex);
    return match ? match[2] : null;
}

export function getWebdavClient(): WebdavClient {
    if (client) return client;

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
                await res.text();
                throw new Error(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`);
            }

            const xml = await res.text();
            const entries: WebdavEntry[] = [];

            // 1. Match all <response> blocks
            // We use a global regex with exec loop to find all occurrences
            const responseRegex = /<([a-zA-Z0-9_]+:)?response(?:[\s\S]*?)>([\s\S]*?)<\/\1?response>/gi;

            let respMatch;
            while ((respMatch = responseRegex.exec(xml)) !== null) {
                const responseBody = respMatch[2]; // Content inside <response>

                // 2. Extract href
                const hrefRaw = getTagValue(responseBody, "href");
                if (!hrefRaw) continue;
                const href = decodeURIComponent(hrefRaw);

                // 3. Parse propstats
                // We must find the propstat block that has a status of 200 OK
                const propstatRegex = /<([a-zA-Z0-9_]+:)?propstat(?:[\s\S]*?)>([\s\S]*?)<\/\1?propstat>/gi;

                let isDirectory = false;
                let size: number | null = null;
                let contentType: string | null = null;
                let lastModified: string | null = null;
                let statusOk = false;

                let psMatch;
                while ((psMatch = propstatRegex.exec(responseBody)) !== null) {
                    const psBody = psMatch[2];

                    // Check status
                    const status = getTagValue(psBody, "status");
                    if (!status || !status.includes("200")) {
                        continue;
                    }

                    statusOk = true;

                    // Extract props from this successful block
                    const propBody = getTagValue(psBody, "prop");
                    if (!propBody) continue;

                    // Check isDirectory: look for <resourcetype> containing <collection/>
                    const resType = getTagValue(propBody, "resourcetype");
                    if (resType && /<([a-zA-Z0-9_]+:)?collection\b/i.test(resType)) {
                        isDirectory = true;
                    }

                    // Size
                    const len = getTagValue(propBody, "getcontentlength");
                    if (len) size = Number(len);

                    // Content Type
                    const type = getTagValue(propBody, "getcontenttype");
                    if (type) contentType = type;

                    // Last Modified
                    const mod = getTagValue(propBody, "getlastmodified");
                    if (mod) lastModified = mod;
                }

                if (!statusOk) continue;

                // Determine name from href
                // Remove trailing slash for name extraction
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

            // Filter out the parent folder itself
            const requestPath = new URL(url).pathname.replace(/\/+$/, "");

            return entries.filter(e => {
                const entryHref = e.href.replace(/\/+$/, "");
                // Decode again just in case strict comparison fails on encoded chars
                return decodeURIComponent(entryHref) !== decodeURIComponent(requestPath);
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