import { contentType } from "@std/media-types";
import { extname } from "@std/path";

export async function streamFileResponse(
    req: Request,
    path: string,
    isHead = false,
    logPrefix = "STREAM",
    preStat?: Deno.FileInfo,
    initialHeaders: Headers = new Headers(),
): Promise<Response | null> {
    let stat = preStat;

    // 1. Stat the file
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
    let code = 200;
    let start = 0;
    let end = size - 1;

    // 2. Set base headers
    const finalHeaders = new Headers(initialHeaders);
    finalHeaders.set("Accept-Ranges", "bytes");

    // Auto-detect content type or fallback
    const mime = contentType(extname(path)) || "video/mp4";
    finalHeaders.set("Content-Type", mime);

    if (stat.mtime) {
        finalHeaders.set("Last-Modified", stat.mtime.toUTCString());
    }

    // 3. Handle HEAD request
    if (isHead) {
        finalHeaders.set("Content-Length", size.toString());
        return new Response(null, { status: 200, headers: finalHeaders });
    }

    // 4. Handle Range request
    const rangeHeader = req.headers.get("Range");
    if (rangeHeader) {
        const rangeMatch = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);

        if (rangeMatch) {
            const startStr = rangeMatch[1];
            const endStr = rangeMatch[2];

            if (startStr && !endStr) {
                // bytes=100-
                start = Number(startStr);
                end = size - 1;
            } else if (!startStr && endStr) {
                // bytes=-100 (suffix range: last 100 bytes)
                start = size - Number(endStr);
                end = size - 1;
            } else if (startStr && endStr) {
                // bytes=100-200
                start = Number(startStr);
                end = Number(endStr);
            }

            // Validate range
            if (start >= size || end >= size || start > end) {
                finalHeaders.set("Content-Range", `bytes */${size}`);
                return new Response(null, { status: 416, headers: finalHeaders });
            }

            code = 206;
        }
    }

    const length = end - start + 1;
    finalHeaders.set("Content-Length", length.toString());

    if (code === 206) {
        finalHeaders.set("Content-Range", `bytes ${start}-${end}/${size}`);
    }

    console.log(`[${logPrefix}] ${code} ${start}-${end}/${size} ${path}`);

    try {
        const file = await Deno.open(path, { read: true });

        // Seek if necessary
        if (start > 0) {
            await file.seek(start, Deno.SeekMode.Start);
        }

        // 5. Stream with Cleanup
        // We use a transform stream to slice the content and ensure the file is closed
        // on both completion (flush) and client disconnection (cancel).
        let bytesSent = 0;

        const limitedStream = file.readable.pipeThrough(new TransformStream({
            transform(chunk, controller) {
                const remaining = length - bytesSent;

                if (remaining <= 0) {
                    controller.terminate();
                    return;
                }

                if (chunk.byteLength > remaining) {
                    controller.enqueue(chunk.subarray(0, remaining));
                    bytesSent += remaining;
                    controller.terminate();
                } else {
                    controller.enqueue(chunk);
                    bytesSent += chunk.byteLength;
                }
            },
            flush() {
                file.close();
            },
            cancel() {
                // IMPORTANT: Close file if client disconnects or stream aborts
                file.close();
            }
        }));

        return new Response(limitedStream, {
            status: code,
            headers: finalHeaders,
        });

    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("Broken pipe") && !msg.includes("aborted")) {
            console.error(`[${logPrefix}] Stream error:`, err);
        }
        return null;
    }
}
