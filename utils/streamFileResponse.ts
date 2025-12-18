import { contentType } from "@std/media-types";
import { extname } from "@std/path";

// 1. Regex Optimization: Handle optional whitespace per HTTP spec
const RANGE_REGEX = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*$/;
const DEFAULT_MIME = "video/mp4";

export async function streamFileResponse(
    req: Request,
    path: string,
    isHead = false,
    logPrefix = "STREAM",
    preStat?: Deno.FileInfo,
    initialHeaders?: Headers, // Changed to optional to allow skipping merge logic
): Promise<Response | null> {

    // 2. Stat (or use pre-stat)
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

    // Optimization: Handle empty files immediately to avoid range math errors
    if (size === 0) {
        return new Response("", { status: 200, headers: initialHeaders });
    }

    const mtime = stat.mtime;

    // 3. Prepare Headers (Plain Object is faster than new Headers())
    const headers: Record<string, string> = {
        "Accept-Ranges": "bytes",
        "Content-Type": contentType(extname(path)) || DEFAULT_MIME
    };

    // Merge initial headers if provided
    if (initialHeaders) {
        initialHeaders.forEach((v, k) => { headers[k] = v; });
    }

    // ETag & Last-Modified
    let lastModifiedStr: string | null = null;
    let etag: string | null = null;

    if (mtime) {
        lastModifiedStr = mtime.toUTCString();
        headers["Last-Modified"] = lastModifiedStr;
        // Optimization: Hex is faster than toString() in some engines, but consistent formatting is key
        etag = `W/"${size.toString(16)}-${mtime.getTime().toString(16)}"`;
        headers["ETag"] = etag;
    }

    // 4. Handle 304 Not Modified
    // ENABLED FOR HEAD: Browsers check HEAD to validate cache. 304 is valid here.
    const ifNoneMatch = req.headers.get("If-None-Match");
    const ifModifiedSince = req.headers.get("If-Modified-Since");

    if (
        (ifNoneMatch && ifNoneMatch === etag) ||
        (ifModifiedSince && lastModifiedStr && ifModifiedSince === lastModifiedStr)
    ) {
        // 304 Response must not contain a body
        return new Response(null, { status: 304, headers });
    }

    // 5. Handle HEAD (Fresh metadata)
    if (isHead) {
        headers["Content-Length"] = String(size);
        return new Response(null, { status: 200, headers });
    }

    // 6. Calculate Range
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
                // bytes=100-
                start = Number(startStr);
                end = size - 1;
            } else if (!startStr && endStr) {
                // bytes=-100
                const suffix = Number(endStr);
                start = Math.max(0, size - suffix);
                end = size - 1;
            } else if (startStr && endStr) {
                // bytes=100-200
                start = Number(startStr);
                end = Number(endStr);
            }

            // Valid Range?
            if (start >= size || end >= size || start > end) {
                headers["Content-Range"] = `bytes */${size}`;
                return new Response(null, { status: 416, headers });
            }

            code = 206;
            headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
        }
    }

    const contentLength = end - start + 1;
    headers["Content-Length"] = String(contentLength);

    if (code !== 200) {
        console.log(`[${logPrefix}] ${code} ${start}-${end}/${size} -> ${path}`);
    }

    // 7. Streaming Strategy
    try {
        const file = await Deno.open(path, { read: true });

        // Seek
        if (start > 0) {
            await file.seek(start, Deno.SeekMode.Start);
        }

        // OPTIMIZATION: Zero-Overhead "Rest of File"
        // Native Deno stream is zero-copy and handles closing automatically.
        if (end === size - 1) {
            return new Response(file.readable, { status: code, headers });
        }

        // SLICING STRATEGY: Partial Range
        let bytesSent = 0;

        const slicedStream = file.readable.pipeThrough(new TransformStream({
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
                    // Zero-copy subarray (view), not a clone
                    controller.enqueue(chunk.subarray(0, remaining));
                    bytesSent += remaining;
                    controller.terminate();
                }
            },
            // Clean up file handle on completion or error
            flush() { file.close(); },
            cancel() { file.close(); }
        }));

        return new Response(slicedStream, { status: code, headers });

    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("Broken pipe") && !msg.includes("aborted") && !msg.includes("Connection reset")) {
            console.error(`[${logPrefix}] Error:`, err);
        }
        return null;
    }
}
