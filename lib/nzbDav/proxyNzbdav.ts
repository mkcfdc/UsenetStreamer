/*
Credit goes to panteLx for their work decoding and implementing proper header handling.
https://github.com/panteLx/UsenetStreamer

*/

import { extname } from "@std/path/posix";

import {
    VIDEO_MIME_MAP,
    NZBDAV_WEBDAV_URL,
    NZBDAV_WEBDAV_USER,
    NZBDAV_WEBDAV_PASS,
    USE_STRM_FILES,
} from "../../env.ts";
import { streamFailureVideo } from "../streamFailureVideo.ts";
import { getWebdavClient } from "../../utils/webdav.ts";

function inferMimeType(fileName: string) {
    const ext = extname(fileName.toLowerCase());
    return VIDEO_MIME_MAP.get(ext) || "application/octet-stream";
}

function sanitizeFileName(file: string) {
    return file.replace(/[\\/:*?"<>|]+/g, "_") || "stream";
}

/**
 * Proxies an NZBDav stream request to an upstream WebDAV server.
 *
 * @param req The standard Deno Request object.
 * @param viewPath The relative path to the file on the WebDAV server.
 * @param fileNameHint An optional hint for the filename.
 * @returns A Promise that resolves to the final Deno Response object.
 */
const httpClient = Deno.createHttpClient({
    poolIdleTimeout: 60_000,
    poolMaxIdlePerHost: 8,
    http2: true,
});
export async function proxyNzbdavStream(
    req: Request,
    viewPath: string,
    fileNameHint = "",
    inFileSystem: boolean = false,
): Promise<Response> {
    const method = req.method.toUpperCase();

    if (!["GET", "HEAD"].includes(method)) {
        return new Response("Method Not Allowed", { status: 405 });
    }

    const emulateHead = method === "HEAD";
    const upstreamMethod = "GET";

    let targetUrl;

    const cleanPath = viewPath.replace(/^\/+/, "");
    const encodedPath = cleanPath.split("/").map(encodeURIComponent).join("/");
    const base = NZBDAV_WEBDAV_URL.replace(/\/+$/, "");
    if (!USE_STRM_FILES) {
        targetUrl = `${base}/${encodedPath}`;
    } else {
        targetUrl = viewPath;
    }

    let fileName = fileNameHint || targetUrl.split("/").pop() || "stream";
    fileName = sanitizeFileName(decodeURIComponent(fileName));

    // 2. Prepare Upstream Headers
    const requestHeaders = new Headers();
    requestHeaders.set("Connection", "keep-alive");
    requestHeaders.set("Accept-Encoding", req.headers.get("accept-encoding") || "identity");

    // Forward Range headers
    const range = req.headers.get("range");
    const ifRange = req.headers.get("if-range");
    console.log(`[HTTP Request] Path: ${cleanPath} | Method: ${method} | Range Header: ${range || 'None'}`);

    if (range) requestHeaders.set("Range", range);
    if (ifRange) requestHeaders.set("If-Range", ifRange);

    // If emulating HEAD (client sent HEAD) AND no range, request a minimal range
    if (emulateHead && !range) {
        requestHeaders.set("Range", "bytes=0-0");
    }

    // Add Basic Auth
    if (NZBDAV_WEBDAV_USER && NZBDAV_WEBDAV_PASS && !USE_STRM_FILES) {
        const token = btoa(`${NZBDAV_WEBDAV_USER}:${NZBDAV_WEBDAV_PASS}`);
        requestHeaders.set("Authorization", `Basic ${token}`);
    }

    const ac = new AbortController();

    const upstream = await fetch(targetUrl, {
        method: upstreamMethod,
        headers: requestHeaders,
        client: httpClient, // may help with performance
        signal: ac.signal,
    }).catch(async (e) => {
        console.error("[NZBDAV] Fetch failed:", e.message);
        if (inFileSystem) {
            const webdav = await getWebdavClient();
            const viewPathFolder = viewPath.substring(0, viewPath.lastIndexOf("/"));
            const deletePath = await webdav.deleteFile(viewPathFolder, { recursive: true });
            if (deletePath) console.log(`[NZBDAV] Deleted folder due to fetch failure: ${viewPathFolder}`);
        }
        return await streamFailureVideo(req, `NZBDAV Fetch Error: ${e.message}`);
    });

    if (!upstream || !upstream.ok) {
        const statusCode = upstream?.status || 502;
        const err: any = new Error(`Upstream returned status ${statusCode}`);
        err.response = { status: statusCode };
        if (inFileSystem) {
            const webdav = await getWebdavClient();
            const viewPathFolder = viewPath.substring(0, viewPath.lastIndexOf("/"));
            const deletePath = await webdav.deleteFile(viewPathFolder, { recursive: true });
            if (deletePath) console.log(`[NZBDAV] Deleted folder due to fetch failure: ${viewPathFolder}`);
        }
        const resp = await streamFailureVideo(req, `NZBDAV Upstream Error: ${statusCode}`);
        return resp ?? new Response(`NZBDAV Upstream Error: ${statusCode}`, { status: statusCode });
    }

    // 5. Prepare Response Headers
    const responseHeaders = new Headers();
    const block = new Set(["transfer-encoding", "set-cookie", "authorization"]);

    // Copy Upstream Headers, skipping blocked ones
    upstream.headers.forEach((value, key) => {
        if (!block.has(key.toLowerCase())) {
            responseHeaders.set(key, value);
        }
    });

    // Custom/Required Headers
    if (!responseHeaders.has("Content-Disposition")) {
        responseHeaders.set("Content-Disposition", `inline; filename="${fileName}"`);
    }

    // Set inferred Content-Type if missing or generic
    if (!responseHeaders.has("Content-Type") || responseHeaders.get("Content-Type") === "application/octet-stream") {
        responseHeaders.set("Content-Type", inferMimeType(fileName));
    }

    // Necessary headers for streaming
    responseHeaders.set("Accept-Ranges", "bytes");
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set(
        "Access-Control-Expose-Headers",
        "Content-Length,Content-Range,Content-Type",
    );
    responseHeaders.set("Connection", "keep-alive");

    const rangeHeader = upstream.headers.get("content-range");
    const match = rangeHeader?.match(/bytes (\d+)-(\d+)\/(\d+|\*)/);
    if (match && match[3] !== "*") {
        const len = Number(match[2]) - Number(match[1]) + 1;
        responseHeaders.set("Content-Length", String(len));
    }

    const status = upstream.status === 206 ? 206 : 200;

    if (emulateHead) {
        await upstream.body?.cancel();
        return new Response(null, { status: status, headers: responseHeaders });
    }

    if (!upstream.body) {
        if (inFileSystem) {
            const webdav = await getWebdavClient();
            const viewPathFolder = viewPath.substring(0, viewPath.lastIndexOf("/"));
            const deletePath = await webdav.deleteFile(viewPathFolder, { recursive: true });
            if (deletePath) console.log(`[NZBDAV] Deleted folder due to empty body: ${viewPathFolder}`);
        }
        return await streamFailureVideo(req, "NZBDAV Upstream Error: Empty Body") || new Response("NZBDAV Upstream Error: Empty Body", { status: 502 });
    }

    return new Response(upstream.body, {
        status: status,
        headers: responseHeaders,
    });
}