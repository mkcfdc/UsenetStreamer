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


const httpClient = Deno.createHttpClient({
    poolIdleTimeout: 30_000,
    poolMaxIdlePerHost: 20,
    http2: true,
});

function inferMimeType(fileName: string) {
    const ext = extname(fileName.toLowerCase());
    return VIDEO_MIME_MAP.get(ext) || "application/octet-stream";
}

function sanitizeFileName(file: string) {
    return file.replace(/[\\/:*?"<>|]+/g, "_") || "stream";
}

async function cleanupOnError(viewPath: string, reason: string) {
    console.warn(`[NZBDAV] Stream failure cleanup: ${reason}`);
    try {
        const webdav = await getWebdavClient();
        const viewPathFolder = viewPath.substring(0, viewPath.lastIndexOf("/"));
        await webdav.deleteFile(viewPathFolder, { recursive: true });
        console.log(`[NZBDAV] Deleted folder: ${viewPathFolder}`);
    } catch (err) {
        console.error(`[NZBDAV] Failed to clean up folder:`, err);
    }
}

export async function proxyNzbdavStream(
    req: Request,
    viewPath: string,
    fileNameHint = "",
    inFileSystem: boolean = false,
): Promise<Response> {
    const method = req.method.toUpperCase();

    if (method !== "GET" && method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    let targetUrl: URL;
    if (USE_STRM_FILES) {
        targetUrl = new URL(viewPath);
    } else {
        const base = NZBDAV_WEBDAV_URL.replace(/\/+$/, "");
        targetUrl = new URL(`${base}/${viewPath.replace(/^\/+/, "")}`);
    }

    const fileName = sanitizeFileName(
        decodeURIComponent(fileNameHint || targetUrl.pathname.split("/").pop() || "stream")
    );

    const requestHeaders = new Headers();

    const range = req.headers.get("range");
    const ifRange = req.headers.get("if-range");

    if (range) requestHeaders.set("Range", range);
    if (ifRange) requestHeaders.set("If-Range", ifRange);

    if (NZBDAV_WEBDAV_USER && NZBDAV_WEBDAV_PASS && !USE_STRM_FILES) {
        requestHeaders.set("Authorization", `Basic ${btoa(`${NZBDAV_WEBDAV_USER}:${NZBDAV_WEBDAV_PASS}`)}`);
    }

    let upstream: Response;
    try {
        upstream = await fetch(targetUrl.toString(), {
            method: method,
            headers: requestHeaders,
            client: httpClient,
            redirect: "follow", // Important for some WebDAV setups
        });
    } catch (e: any) {
        if (inFileSystem) await cleanupOnError(viewPath, `Fetch failed: ${e.message}`);
        return (await streamFailureVideo(req, `Fetch Error: ${e.message}`)) || new Response("Upstream Error", { status: 502 });
    }

    if (!upstream.ok) {
        if (inFileSystem) await cleanupOnError(viewPath, `Upstream status ${upstream.status}`);

        // If upstream 404s, return 404 immediately
        if (upstream.status === 404) return new Response("Not Found", { status: 404 });

        return (await streamFailureVideo(req, `Upstream Error: ${upstream.status}`)) ||
            new Response(`Upstream Error: ${upstream.status}`, { status: upstream.status });
    }

    const responseHeaders = new Headers(upstream.headers);

    const blockList = ["server", "set-cookie", "transfer-encoding", "connection", "keep-alive", "authorization"];
    blockList.forEach(h => responseHeaders.delete(h));

    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type, Accept-Ranges");

    const existingType = responseHeaders.get("Content-Type");
    if (!existingType || existingType === "application/octet-stream") {
        responseHeaders.set("Content-Type", inferMimeType(fileName));
    }

    responseHeaders.set("Content-Disposition", `inline; filename="${fileName}"`);

    if (method === "HEAD") {
        await upstream.body?.cancel();
        return new Response(null, {
            status: upstream.status,
            headers: responseHeaders
        });
    }

    if (!upstream.body) {
        if (inFileSystem) await cleanupOnError(viewPath, "Empty Body received");
        return new Response("Upstream returned empty body", { status: 502 });
    }

    return new Response(upstream.body, {
        status: upstream.status, // Pass 200 or 206 exactly as received
        headers: responseHeaders,
    });
}
