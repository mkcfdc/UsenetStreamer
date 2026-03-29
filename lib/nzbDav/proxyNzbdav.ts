import { extname } from "@std/path/posix";
import { Config } from "../../env.ts";
import { streamFailureVideo } from "../streamFailureVideo.ts";

// Connection pooling optimized for streaming
// Note: If you ever experience random stream drops with older WebDAV servers, 
// consider changing http2 to `false`. Some older servers have spotty HTTP/2 chunking.
const httpClient = Deno.createHttpClient({
    poolIdleTimeout: 60_000,
    poolMaxIdlePerHost: 50,
    http2: false,
});

const AUTH_HEADER =
    Config.NZBDAV_WEBDAV_USER && Config.NZBDAV_WEBDAV_PASS
        ? `Basic ${btoa(`${Config.NZBDAV_WEBDAV_USER}:${Config.NZBDAV_WEBDAV_PASS}`)}`
        : null;

const WEBDAV_BASE = Config.NZBDAV_WEBDAV_URL.replace(/\/+$/, "");
const UNSAFE_CHARS_RX = /[\\/:*?"<>|]+/g;

const PASSTHROUGH_HEADERS = [
    "Content-Length",
    "Content-Range",
    "Accept-Ranges",
    "Last-Modified",
    "ETag",
] as const;

function sanitizeFileName(file: string): string {
    return file.replace(UNSAFE_CHARS_RX, "_") || "stream";
}

function inferMimeType(fileName: string): string {
    const ext = extname(fileName).toLowerCase();
    return Config.VIDEO_MIME_MAP.get(ext) ?? "application/octet-stream";
}

function safeDecodeURIComponent(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

function buildContentDisposition(fileName: string): string {
    const asciiFallback = sanitizeFileName(fileName).replace(/"/g, "");
    const encodedUtf8 = encodeURIComponent(fileName);
    return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`;
}

function buildTargetUrl(viewPath: string): string {
    if (Config.USE_STRM_FILES) return viewPath;
    const cleanPath = viewPath.startsWith("/") ? viewPath.slice(1) : viewPath;
    return `${WEBDAV_BASE}/${cleanPath}`;
}

function buildUpstreamHeaders(req: Request): Headers {
    const headers = new Headers();
    const range = req.headers.get("Range");
    const ifRange = req.headers.get("If-Range");

    if (range) {
        headers.set("Range", range);
        headers.set("Accept-Encoding", "identity");
    }
    if (ifRange) headers.set("If-Range", ifRange);

    if (AUTH_HEADER && !Config.USE_STRM_FILES) {
        headers.set("Authorization", AUTH_HEADER);
    }

    return headers;
}

function buildResponseHeaders(upstream: Response, fileName: string): Headers {
    const headers = new Headers();
    const upHeaders = upstream.headers;

    for (const header of PASSTHROUGH_HEADERS) {
        const value = upHeaders.get(header);
        if (value) headers.set(header, value);
    }

    headers.set("Access-Control-Allow-Origin", "*");
    headers.set(
        "Access-Control-Expose-Headers",
        "Content-Length, Content-Range, Content-Type, Accept-Ranges, ETag",
    );

    const upstreamType = upHeaders.get("Content-Type");
    headers.set(
        "Content-Type",
        upstreamType && upstreamType !== "application/octet-stream"
            ? upstreamType
            : inferMimeType(fileName),
    );

    headers.set("Content-Disposition", buildContentDisposition(fileName));

    return headers;
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
    try {
        await body?.cancel();
    } catch {
        // ignore - stream may already be closed
    }
}

function extractFileName(targetUrl: string, hint: string): string {
    if (hint) return hint;
    try {
        // Use URL to safely strip query parameters if they exist
        const urlObj = new URL(targetUrl);
        return urlObj.pathname.split("/").pop() || "stream";
    } catch {
        return targetUrl.split("/").pop()?.split("?")[0] || "stream";
    }
}

export async function proxyNzbdavStream(
    req: Request,
    viewPath: string,
    fileNameHint = "",
    inFileSystem = false,
): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    const targetUrl = buildTargetUrl(viewPath);
    const hasRange = req.headers.has("Range");

    try {
        const upstream = await fetch(targetUrl, {
            method: req.method,
            headers: buildUpstreamHeaders(req),
            client: httpClient,
            redirect: "follow",
            signal: req.signal, // This handles cascade aborts natively
        });

        if (!upstream.ok) {
            await cancelBody(upstream.body);

            if (inFileSystem) {
                console.warn(`[NZBDAV] Upstream ${upstream.status} for: ${viewPath}`);
            }

            if (upstream.status === 416) {
                return new Response("Range Not Satisfiable", { status: 416 });
            }

            const errorReason = `Upstream Error: ${upstream.status} ${upstream.statusText}`;

            // If the user requested a specific byte range, sending a failure video from 
            // byte 0 will corrupt playback. Only send failure video on fresh requests.
            if (!hasRange) {
                const failureVid = await streamFailureVideo(req, errorReason);
                if (failureVid) return failureVid;
            }

            return new Response(errorReason, { status: upstream.status });
        }

        const rawName = extractFileName(targetUrl, fileNameHint);
        const decodedName = safeDecodeURIComponent(rawName);
        const resHeaders = buildResponseHeaders(upstream, decodedName);

        if (req.method === "HEAD") {
            await cancelBody(upstream.body);
            return new Response(null, { status: upstream.status, headers: resHeaders });
        }

        // Deno will automatically link `upstream.body` to this Response.
        // If the client disconnects, Deno handles canceling `upstream.body` instantly.
        return new Response(upstream.body, { status: upstream.status, headers: resHeaders });

    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);

        if (req.signal.aborted) {
            if (inFileSystem) {
                console.warn(`[NZBDAV] Client aborted: ${viewPath}`);
            }
            return new Response(null, { status: 499 });
        }

        if (inFileSystem) {
            console.warn(`[NZBDAV] Fetch error for ${viewPath}: ${message}`);
        }

        const errorReason = `Network Error: ${message}`;

        if (!hasRange) {
            const failureVid = await streamFailureVideo(req, errorReason);
            if (failureVid) return failureVid;
        }

        return new Response(errorReason, { status: 502 });
    }
}
