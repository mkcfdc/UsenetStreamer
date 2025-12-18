import { contentType } from "@std/media-types";
import { extname } from "@std/path";

const RANGE_REGEX = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*$/;
const DEFAULT_MIME = "video/mp4";

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

    const headers = new Headers();
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Type", contentType(extname(path)) || DEFAULT_MIME);

    if (initialHeaders) {
        for (const [k, v] of initialHeaders.entries()) headers.set(k, v);
    }

    let lastModifiedStr: string | null = null;
    let etag: string | null = null;

    if (mtime) {
        lastModifiedStr = mtime.toUTCString();
        headers.set("Last-Modified", lastModifiedStr);
        etag = `W/"${size.toString(16)}-${mtime.getTime().toString(16)}"`;
        headers.set("ETag", etag);
    }

    const ifNoneMatch = req.headers.get("If-None-Match");
    const ifModifiedSince = req.headers.get("If-Modified-Since");

    if (
        (etag && ifNoneMatch && ifNoneMatch === etag) ||
        (lastModifiedStr && ifModifiedSince && ifModifiedSince === lastModifiedStr)
    ) {
        return new Response(null, { status: 304, headers });
    }

    if (isHead) {
        headers.set("Content-Length", String(size));
        return new Response(null, { status: 200, headers });
    }

    let code = 200;
    let start = 0;
    let end = size - 1;

    const rangeHeader = req.headers.get("Range");
    if (rangeHeader) {
        const match = RANGE_REGEX.exec(rangeHeader);
        if (match) {
            const startStr = match[1];
            const endStr = match[2];

            if (startStr && !endStr) {
                start = Number(startStr);
                end = size - 1;
            } else if (!startStr && endStr) {
                const suffix = Number(endStr);
                start = Math.max(0, size - suffix);
                end = size - 1;
            } else if (startStr && endStr) {
                start = Number(startStr);
                end = Number(endStr);
            }

            if (start >= size || end >= size || start > end) {
                headers.set("Content-Range", `bytes */${size}`);
                return new Response(null, { status: 416, headers });
            }

            code = 206;
            headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
        }
    }

    const contentLength = end - start + 1;
    headers.set("Content-Length", String(contentLength));

    if (code === 206) {
        console.log(`[${logPrefix}] ${code} ${start}-${end}/${size} -> ${path}`);
    }

    let file: Deno.FsFile | undefined;

    try {
        file = await Deno.open(path, { read: true });

        if (start > 0) {
            await file.seek(start, Deno.SeekMode.Start);
        }

        // Fast path: stream "rest of file" without extra transforms.
        if (end === size - 1) {
            const body = file.readable;
            req.signal?.addEventListener?.("abort", () => {
                try {
                    file?.close();
                } catch {
                    // ignore
                }
            }, { once: true });

            return new Response(body, { status: code, headers });
        }

        // Partial-range path: limit bytes via TransformStream and ensure close on all paths.
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
                    return;
                }

                controller.enqueue(chunk.subarray(0, remaining));
                bytesSent += remaining;
                controller.terminate();
            },
            flush() {
                try {
                    file?.close();
                } catch {
                    // ignore
                }
            },
        });

        req.signal?.addEventListener?.("abort", () => {
            try {
                file?.close();
            } catch {
                // ignore
            }
            try {
                limiter.writable.abort();
            } catch {
                // ignore
            }
        }, { once: true });

        return new Response(file.readable.pipeThrough(limiter), { status: code, headers });
    } catch (err) {
        try {
            file?.close();
        } catch {
            // ignore
        }

        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("Broken pipe") && !msg.includes("aborted") && !msg.includes("Connection reset")) {
            console.error(`[${logPrefix}] Error:`, err);
        }
        return null;
    }
}
