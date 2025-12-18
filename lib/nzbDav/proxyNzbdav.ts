import { extname } from "@std/path/posix";
import { Config } from "../../env.ts";
import { streamFailureVideo } from "../streamFailureVideo.ts";

// 1) Connection Pooling Optimized for Streaming
const httpClient = Deno.createHttpClient({
    poolIdleTimeout: 60_000,
    poolMaxIdlePerHost: 50,
    http2: true,
});

// 2) Pre-calculate Static Headers
const AUTH_HEADER =
    (Config.NZBDAV_WEBDAV_USER && Config.NZBDAV_WEBDAV_PASS)
        ? `Basic ${btoa(`${Config.NZBDAV_WEBDAV_USER}:${Config.NZBDAV_WEBDAV_PASS}`)}`
        : null;

const WEBDAV_BASE = Config.NZBDAV_WEBDAV_URL.replace(/\/+$/, "");
const UNSAFE_CHARS_RX = /[\\/:*?"<>|]+/g;

function sanitizeFileName(file: string): string {
    return file.replace(UNSAFE_CHARS_RX, "_") || "stream";
}

function inferMimeType(fileName: string): string {
    const ext = extname(fileName).toLowerCase();
    return Config.VIDEO_MIME_MAP.get(ext) || "application/octet-stream";
}

/**
 * Avoid decodeURIComponent throwing on malformed % sequences.
 */
function safeDecodeURIComponent(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

/**
 * Safer Content-Disposition:
 * - Provides ASCII fallback via filename=""
 * - Provides UTF-8 via filename*= (RFC 5987)
 */
function contentDispositionInline(fileName: string): string {
    const asciiFallback = sanitizeFileName(fileName).replace(/"/g, "");
    const encodedUtf8 = encodeURIComponent(fileName);
    return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`;
}

function cleanupOnError(viewPath: string, reason: string) {
    console.warn(`[NZBDAV] Stream failure (${reason}) for: ${viewPath}`);
    // Logic for deleting corrupted local folders can go here if needed
}

export async function proxyNzbdavStream(
    req: Request,
    viewPath: string,
    fileNameHint = "",
    inFileSystem: boolean = false,
): Promise<Response> {
    // 1. Method Check
    if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    // 2. URL Construction
    let targetUrl: string;
    if (Config.USE_STRM_FILES) {
        targetUrl = viewPath;
    } else {
        const cleanPath = viewPath.startsWith("/") ? viewPath.substring(1) : viewPath;
        targetUrl = `${WEBDAV_BASE}/${cleanPath}`;
    }

    // 3. Request Header Construction
    const upstreamHeaders = new Headers();
    const range = req.headers.get("Range");
    const ifRange = req.headers.get("If-Range");

    if (range) upstreamHeaders.set("Range", range);
    if (ifRange) upstreamHeaders.set("If-Range", ifRange);

    // TOP-5: Prevent upstream gzip/br which can break Range semantics on some servers/proxies
    if (range) upstreamHeaders.set("Accept-Encoding", "identity");

    if (AUTH_HEADER && !Config.USE_STRM_FILES) {
        upstreamHeaders.set("Authorization", AUTH_HEADER);
    }

    try {
        // TOP-5: Propagate abort to upstream fetch to stop ghost downloads
        const upstream = await fetch(targetUrl, {
            method: req.method,
            headers: upstreamHeaders,
            client: httpClient,
            redirect: "follow",
            signal: req.signal,
        });

        // If the client aborted right as upstream returned, cancel quickly.
        if (req.signal.aborted) {
            await upstream.body?.cancel();
            throw req.signal.reason;
        }

        // Also cancel upstream body if the client aborts mid-stream.
        req.signal.addEventListener("abort", () => {
            upstream.body?.cancel().catch(() => { });
        }, { once: true });

        // 4. Upstream Error Handling (4xx/5xx)
        if (!upstream.ok) {
            const status = upstream.status;
            const statusText = upstream.statusText;

            if (inFileSystem) cleanupOnError(viewPath, `Upstream status ${status}`);

            // IMPORTANT: Cancel the upstream body to free the connection pool socket immediately.
            await upstream.body?.cancel();

            // TOP-5: Handle 416 separately (common during seeking / growing files)
            if (status === 416) {
                return new Response("Range Not Satisfiable", { status: 416 });
            }

            const errorReason = `Upstream Error: ${status} ${statusText}`;
            const failureVid = await streamFailureVideo(req, errorReason);
            if (failureVid) return failureVid;

            return new Response(errorReason, { status });
        }

        // 5. Response Header Optimization (Allowlist Strategy)
        const resHeaders = new Headers();
        const upHeaders = upstream.headers;

        // Copy only critical video headers
        if (upHeaders.has("Content-Length")) resHeaders.set("Content-Length", upHeaders.get("Content-Length")!);
        if (upHeaders.has("Content-Range")) resHeaders.set("Content-Range", upHeaders.get("Content-Range")!);
        if (upHeaders.has("Accept-Ranges")) resHeaders.set("Accept-Ranges", upHeaders.get("Accept-Ranges")!);
        if (upHeaders.has("Last-Modified")) resHeaders.set("Last-Modified", upHeaders.get("Last-Modified")!);
        if (upHeaders.has("ETag")) resHeaders.set("ETag", upHeaders.get("ETag")!);

        // CORS
        resHeaders.set("Access-Control-Allow-Origin", "*");
        resHeaders.set(
            "Access-Control-Expose-Headers",
            "Content-Length, Content-Range, Content-Type, Accept-Ranges, ETag",
        );

        // Content-Type / Disposition
        const rawName = fileNameHint || targetUrl.split("/").pop() || "stream";
        const decodedName = safeDecodeURIComponent(rawName);

        const existingType = upHeaders.get("Content-Type");
        if (existingType && existingType !== "application/octet-stream") {
            resHeaders.set("Content-Type", existingType);
        } else {
            resHeaders.set("Content-Type", inferMimeType(decodedName));
        }

        // TOP-5: Safer Content-Disposition that handles UTF-8 + quotes safely
        resHeaders.set("Content-Disposition", contentDispositionInline(decodedName));

        // 6. Handle HEAD
        if (req.method === "HEAD") {
            await upstream.body?.cancel();
            return new Response(null, {
                status: upstream.status,
                headers: resHeaders,
            });
        }

        // 7. Stream Success
        return new Response(upstream.body, {
            status: upstream.status,
            headers: resHeaders,
        });
    } catch (e: any) {
        // 8. Network / Abort Error Handling
        const message = e?.message ?? String(e);

        // If the client aborted, don't generate error video (wasted work).
        if (req.signal.aborted) {
            if (inFileSystem) cleanupOnError(viewPath, `Client aborted: ${message}`);
            return new Response(null, { status: 499 }); // non-standard but common in logs (nginx)
        }

        if (inFileSystem) cleanupOnError(viewPath, `Fetch exception: ${message}`);

        const errorReason = `Network Error: ${message}`;
        const failureVid = await streamFailureVideo(req, errorReason);
        if (failureVid) return failureVid;

        return new Response(errorReason, { status: 502 });
    }
}
