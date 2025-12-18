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
const ROOT_PATH = (Config.NZBDAV_WEBDAV_ROOT || "").replace(/(^\/+|\/+$)/g, ""); // strip both ends
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

export function getWebdavClient(): WebdavClient {
    if (client) return client;

    client = {
        getDirectoryContents: async (directory: string) => {
            const cleanPath = directory.replace(/(^\/+|\/+$)/g, "");
            const url = cleanPath ? `${REMOTE_ROOT_URL}/${cleanPath}` : REMOTE_ROOT_URL;

            const targetPathEncoded = encodeURI(cleanPath);

            console.log(`[WebDAV] PROPFIND ${url}`);

            const res = await fetch(url, {
                method: "PROPFIND",
                headers: {
                    "Authorization": AUTH_HEADER,
                    "Depth": "1",
                    "Content-Type": "application/xml",
                    'Connection': 'keep-alive'
                },
                body: PROPFIND_BODY
            });

            if (res.status !== 207) {
                const txt = await res.text();
                throw new Error(`WebDAV PROPFIND failed: ${res.status} ${res.statusText} - ${txt.substring(0, 100)}`);
            }

            const xml = await res.text();
            const entries: WebdavEntry[] = [];
            const xmlLen = xml.length;

            // 3. Optimization: "Cursor-based" String Parsing
            // Much faster than Regex for known structures in tight loops.
            // We look for <d:response> (or <D:response>) blocks.

            let pos = 0;

            // Find start of first response
            // We search case-insensitive for the tag structure roughly
            while (pos < xmlLen) {
                // Find <...response>
                const startIdx = xml.indexOf("response>", pos);
                if (startIdx === -1) break;

                // Determine actual start (accounting for namespace prefix length)
                // We look backwards for the opening '<'
                const openTag = xml.lastIndexOf("<", startIdx);
                if (openTag === -1) { pos = startIdx + 9; continue; } // Should not happen

                // Find end of this response block </...response>
                const endTagStr = xml.substring(openTag + 1, startIdx + 8); // e.g. "d:response"
                const closeTag = `</${endTagStr}>`;
                const endIdx = xml.indexOf(closeTag, startIdx);

                if (endIdx === -1) {
                    pos = startIdx + 9;
                    continue;
                }

                // Update position for next iteration immediately
                pos = endIdx + closeTag.length;

                // Extract the block content for processing
                // (using substring is cheap in V8)
                const block = xml.substring(openTag, endIdx);

                // --- FAST CHECKS ---

                // 1. Check Status (Fastest way: indexOf)
                // If it doesn't have "200 OK", skip it.
                if (block.indexOf("HTTP/1.1 200") === -1) continue;

                // 2. Extract Href
                const href = extractValue(block, "href");
                if (!href) continue;

                // 3. Filter "Self" (Current Directory)
                // Check if the href ends with the target path (ignoring trailing slashes)
                // This removes the need to filter the array at the very end
                const trimmedHref = href.endsWith("/") ? href.slice(0, -1) : href;
                // Simple check: does the end of the href match our requested path?
                // We compare encoded versions to avoid decoding everything.
                if (trimmedHref.endsWith(targetPathEncoded)) {
                    // Double check it's not a partial match (e.g. /foo/bar matching /bar)
                    const separator = trimmedHref.length - targetPathEncoded.length - 1;
                    if (targetPathEncoded === "" || trimmedHref[separator] === '/') {
                        continue;
                    }
                }

                // --- EXTRACTION ---

                const isDirectory = block.indexOf("collection/>") !== -1;

                // Parse Name (Fast string split)
                // We do this on the decoded string for display
                const decodedHref = decodeURIComponent(href);
                // Logic: Remove trailing slash -> split -> take last item
                const name = (href.endsWith('/')
                    ? decodedHref.substring(0, decodedHref.length - 1)
                    : decodedHref).split('/').pop() || "";

                // Get Content Length
                // If directory, size is null
                let size: number | null = null;
                if (!isDirectory) {
                    const sizeStr = extractValue(block, "getcontentlength");
                    if (sizeStr) size = parseInt(sizeStr, 10);
                }

                // Get Last Modified
                const lastModified = extractValue(block, "getlastmodified");

                // Get Content Type
                const type = extractValue(block, "getcontenttype");

                entries.push({
                    name,
                    href: decodedHref,
                    isDirectory,
                    size,
                    type,
                    lastModified
                });
            }

            return entries;
        },
    };

    return client;
}

/**
 * Highly optimized XML tag extractor using index search.
 * Handles namespaces (d:tag vs tag) automatically.
 */
function extractValue(xml: string, tagName: string): string | null {
    // Look for "tagName>" to ignore namespace prefix logic
    const search = tagName + ">";
    const startIdx = xml.indexOf(search);
    if (startIdx === -1) return null;

    // The value starts after the bracket
    const valStart = startIdx + search.length;

    // Find the closing tag (</d:tagName> or </tagName>)
    // We strictly look for "</" followed eventually by "tagName>"
    // But for speed, finding the next "<" is usually sufficient in simple properties
    const valEnd = xml.indexOf("<", valStart);

    if (valEnd === -1) return null;

    return xml.substring(valStart, valEnd);
}

/**
 * Micro-optimized path normalizer
 */
export function normalizeNzbdavPath(path: string): string {
    if (!path || path === "/") return "/";

    // 1. Replace backslashes and collapse multiple slashes
    // This regex is extremely optimized for V8
    const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");

    if (normalized === "/") return "/";

    // 2. Trim slashes manually (faster than Regex ^/ and /$)
    const start = (normalized.charCodeAt(0) === 47) ? 1 : 0; // 47 is '/'
    let end = normalized.length;
    if (normalized.charCodeAt(end - 1) === 47) end--;

    return "/" + normalized.substring(start, end);
}
