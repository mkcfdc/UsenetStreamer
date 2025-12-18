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

const AUTH_HEADER =
    "Basic " + btoa(`${Config.NZBDAV_WEBDAV_USER}:${Config.NZBDAV_WEBDAV_PASS}`);

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

async function readTextCapped(res: Response, max = 300): Promise<string> {
    try {
        const txt = await res.text();
        return txt.length > max ? txt.slice(0, max) : txt;
    } catch {
        return "";
    }
}

export function getWebdavClient(): WebdavClient {
    if (client) return client;

    client = {
        getDirectoryContents: async (directory: string) => {
            const cleanPath = directory.replace(/(^\/+|\/+$)/g, "");
            const url = cleanPath ? `${REMOTE_ROOT_URL}/${cleanPath}` : REMOTE_ROOT_URL;

            const targetPathEncoded = cleanPath
                ? cleanPath.split("/").map(encodeURIComponent).join("/")
                : "";

            const res = await fetch(url, {
                method: "PROPFIND",
                client: httpClient,
                headers: {
                    "Authorization": AUTH_HEADER,
                    "Depth": "1",
                    "Content-Type": "application/xml",
                },
                body: PROPFIND_BODY,
            });

            if (res.status !== 207) {
                const txt = await readTextCapped(res, 200);
                throw new Error(
                    `WebDAV PROPFIND failed: ${res.status} ${res.statusText} - ${txt}`,
                );
            }

            const xml = await res.text();
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

                const tagName = xml.substring(openTag + 1, gt).trim(); // d:response / D:response
                const closeTag = `</${tagName}>`;

                const endIdx = xml.indexOf(closeTag, gt);
                if (endIdx === -1) {
                    pos = gt + 1;
                    continue;
                }

                pos = endIdx + closeTag.length;

                const block = xml.substring(openTag, endIdx);

                if (block.indexOf("200 OK") === -1 && block.indexOf(" 200 ") === -1) continue;

                const href = extractValue(block, "href");
                if (!href) continue;

                const hrefTrimmed = href.endsWith("/") ? href.slice(0, -1) : href;

                if (targetPathEncoded) {
                    if (hrefTrimmed.endsWith(targetPathEncoded)) {
                        const sepIdx = hrefTrimmed.length - targetPathEncoded.length - 1;
                        if (sepIdx < 0 || hrefTrimmed[sepIdx] === "/") {
                            continue;
                        }
                    }
                } else {
                    // Root listing: many servers include self entry; usually name becomes "" and is harmless.
                    // We don’t try to aggressively filter here to avoid false positives.
                }

                const isDirectory = block.indexOf("collection/>") !== -1 ||
                    block.indexOf("<D:collection/>") !== -1 ||
                    block.indexOf("<d:collection/>") !== -1;

                const decodedHref = safeDecodeURIComponent(href);

                const name = (href.endsWith("/")
                    ? decodedHref.substring(0, decodedHref.length - 1)
                    : decodedHref).split("/").pop() || "";

                let size: number | null = null;
                if (!isDirectory) {
                    const sizeStr = extractValue(block, "getcontentlength");
                    if (sizeStr) {
                        const n = parseInt(sizeStr, 10);
                        size = Number.isFinite(n) ? n : null;
                    }
                }

                const lastModified = extractValue(block, "getlastmodified");
                const type = extractValue(block, "getcontenttype");

                entries.push({
                    name,
                    href: decodedHref,
                    isDirectory,
                    size,
                    type,
                    lastModified,
                });
            }

            return entries;
        },
    };

    return client;
}

function extractValue(xml: string, tagName: string): string | null {
    const search = tagName + ">";
    const startIdx = xml.indexOf(search);
    if (startIdx === -1) return null;

    const valStart = startIdx + search.length;
    const valEnd = xml.indexOf("<", valStart);
    if (valEnd === -1) return null;

    return xml.substring(valStart, valEnd);
}

export function normalizeNzbdavPath(path: string): string {
    if (!path || path === "/") return "/";

    const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
    if (normalized === "/") return "/";

    const start = (normalized.charCodeAt(0) === 47) ? 1 : 0;
    let end = normalized.length;
    if (normalized.charCodeAt(end - 1) === 47) end--;

    return "/" + normalized.substring(start, end);
}
