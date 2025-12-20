import { contentType } from "@std/media-types";
import { extname } from "@std/path";

const RANGE_REGEX = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*$/;
const DEFAULT_MIME = "video/mp4";

// Errors that indicate client disconnection - not worth logging
const IGNORED_ERROR_PATTERNS = ["Broken pipe", "aborted", "Connection reset", "resource closed"];

function isIgnorableError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return IGNORED_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

function safeClose(file: Deno.FsFile | undefined): void {
    try {
        file?.close();
    } catch {
        // ignore - already closed or invalid
    }
}

export async function streamFileResponse(
    req: Request,
    path: string,
    isHead = false,
    logPrefix = "STREAM",
    preStat?: Deno.FileInfo,
    initialHeaders?: Headers,
): Promise<Response | null> {
    let stat = preStat;
    if (!stat) {
        try {
            stat = await Deno.stat(path);
        } catch (e) {
            if (e instanceof Deno.errors.NotFound) return null;
            throw e;
        }
    }
    if (!stat.isFile) return null;

    const size = stat.size;
    if (size === 0) {
        return new Response(isHead ? null : "", { status: 200, headers: initialHeaders });
    }

    const mtime = stat.mtime;

    const headers = new Headers(initialHeaders);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Type", contentType(extname(path)) ?? DEFAULT_MIME);

    let etag: string | null = null;
    let lastModifiedStr: string | null = null;

    if (mtime) {
        lastModifiedStr = mtime.toUTCString();
        etag = `W/"${size.toString(16)}-${mtime.getTime().toString(16)}"`;
        headers.set("Last-Modified", lastModifiedStr);
        headers.set("ETag", etag);
    }

    // Conditional request handling
    const ifNoneMatch = req.headers.get("If-None-Match");
    const ifModifiedSince = req.headers.get("If-Modified-Since");

    if (
        (etag && ifNoneMatch === etag) ||
        (lastModifiedStr && ifModifiedSince === lastModifiedStr)
    ) {
        return new Response(null, { status: 304, headers });
    }

    if (isHead) {
        headers.set("Content-Length", String(size));
        return new Response(null, { status: 200, headers });
    }

    let status = 200;
    let start = 0;
    let end = size - 1;

    const rangeHeader = req.headers.get("Range");
    if (rangeHeader) {
        const match = RANGE_REGEX.exec(rangeHeader);
        if (match) {
            const [, startStr, endStr] = match;

            if (startStr && !endStr) {
                start = Number(startStr);
            } else if (!startStr && endStr) {
                start = Math.max(0, size - Number(endStr));
            } else if (startStr && endStr) {
                start = Number(startStr);
                end = Number(endStr);
            }

            if (start >= size || end >= size || start > end) {
                headers.set("Content-Range", `bytes */${size}`);
                return new Response(null, { status: 416, headers });
            }

            status = 206;
            headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
        }
    }

    const contentLength = end - start + 1;
    headers.set("Content-Length", String(contentLength));

    if (status === 206) {
        console.log(`[${logPrefix}] ${status} ${start}-${end}/${size} -> ${path}`);
    }

    let file: Deno.FsFile | undefined;

    try {
        file = await Deno.open(path, { read: true });

        if (start > 0) {
            await file.seek(start, Deno.SeekMode.Start);
        }

        // Fast path: stream rest of file without transforms
        if (end === size - 1) {
            req.signal?.addEventListener("abort", () => safeClose(file), { once: true });
            return new Response(file.readable, { status, headers });
        }

        // Partial-range path: limit bytes via TransformStream
        let bytesSent = 0;

        const limiter = new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                const remaining = contentLength - bytesSent;
                if (remaining <= 0) {
                    controller.terminate();
                    return;
                }

                if (chunk.byteLength <= remaining) {
                    controller.enqueue(chunk);
                    bytesSent += chunk.byteLength;
                } else {
                    controller.enqueue(chunk.subarray(0, remaining));
                    bytesSent += remaining;
                    controller.terminate();
                }
            },
            flush() {
                safeClose(file);
            },
        });

        req.signal?.addEventListener("abort", () => {
            safeClose(file);
            limiter.writable.abort().catch(() => { });
        }, { once: true });

        return new Response(file.readable.pipeThrough(limiter), { status, headers });
    } catch (err) {
        safeClose(file);

        if (!isIgnorableError(err)) {
            console.error(`[${logPrefix}] Error:`, err);
        }
        return null;
    }
}