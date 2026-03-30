import { contentType } from "@std/media-types";
import { extname } from "@std/path";

const DEFAULT_MIME = "video/mp4";

// Errors that indicate client disconnection - not worth logging
const IGNORED_ERROR_PATTERNS = ["Broken pipe", "aborted", "Connection reset", "resource closed"];

function isIgnorableError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    // Optimized loop - fast native array checking
    for (let i = 0; i < IGNORED_ERROR_PATTERNS.length; i++) {
        if (msg.includes(IGNORED_ERROR_PATTERNS[i])) return true;
    }
    return false;
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
    const headers = new Headers(initialHeaders);

    if (size === 0) {
        return new Response(isHead ? null : "", { status: 200, headers });
    }

    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Type", contentType(extname(path)) ?? DEFAULT_MIME);

    // Conditional request handling
    if (stat.mtime) {
        const lastModifiedStr = stat.mtime.toUTCString();
        const etag = `W/"${size.toString(16)}-${stat.mtime.getTime().toString(16)}"`;

        headers.set("Last-Modified", lastModifiedStr);
        headers.set("ETag", etag);

        if (
            req.headers.get("If-None-Match") === etag ||
            req.headers.get("If-Modified-Since") === lastModifiedStr
        ) {
            return new Response(null, { status: 304, headers });
        }
    }

    if (isHead) {
        headers.set("Content-Length", size.toString());
        return new Response(null, { status: 200, headers });
    }

    let status = 200;
    let start = 0;
    let end = size - 1;

    // Fast-path Range parsing (No Regex)
    const rangeHeader = req.headers.get("Range");
    if (rangeHeader?.startsWith("bytes=")) {
        const parts = rangeHeader.slice(6).split("-");
        const startStr = parts[0];
        const endStr = parts[1];

        if (startStr !== "") {
            start = parseInt(startStr, 10);
            end = endStr !== "" ? parseInt(endStr, 10) : size - 1;
        } else if (endStr !== "") {
            start = Math.max(0, size - parseInt(endStr, 10));
            end = size - 1;
        }

        if (start >= size || end >= size || start > end) {
            headers.set("Content-Range", `bytes */${size}`);
            return new Response(null, { status: 416, headers });
        }

        status = 206;
        headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    }

    const contentLength = end - start + 1;
    headers.set("Content-Length", contentLength.toString());

    if (status === 206) {
        console.log(`[${logPrefix}] ${status} ${start}-${end}/${size} -> ${path}`);
    }

    let file: Deno.FsFile;
    try {
        file = await Deno.open(path, { read: true });
    } catch (err) {
        if (!isIgnorableError(err)) console.error(`[${logPrefix}] Error opening file:`, err);
        return null;
    }

    try {
        if (start > 0) {
            await file.seek(start, Deno.SeekMode.Start);
        }

        // Fast path: Deno handles the stream natively, zero-copy
        if (end === size - 1) {
            // No manual abort listeners needed. Deno safely assumes ownership here.
            return new Response(file.readable, { status, headers });
        }

        // Partial-range path: limit bytes via TransformStream
        let bytesSent = 0;
        const limiter = new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                const remaining = contentLength - bytesSent;
                if (remaining <= 0) {
                    controller.terminate(); // Automatically cancels file.readable upstream
                    return;
                }

                if (chunk.byteLength <= remaining) {
                    controller.enqueue(chunk);
                    bytesSent += chunk.byteLength;
                } else {
                    controller.enqueue(chunk.subarray(0, remaining)); // Zero-copy slice
                    bytesSent += remaining;
                    controller.terminate();
                }
            }
        });

        // pipeThrough links the streams. If limiter terminates, file.readable gets cancelled.
        return new Response(file.readable.pipeThrough(limiter), { status, headers });

    } catch (err) {
        // Only trigger manual close if an error happens *before* passing stream to Response
        file.close();
        if (!isIgnorableError(err)) {
            console.error(`[${logPrefix}] Error processing stream:`, err);
        }
        return null;
    }
}
