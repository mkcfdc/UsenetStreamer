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
    let responseBody: BodyInit | null = null;

    // 2. Set base headers
    const finalHeaders = new Headers(initialHeaders);
    finalHeaders.set("Accept-Ranges", "bytes");
    finalHeaders.set("Content-Type", "video/mp4");
    if (stat.mtime) {
        finalHeaders.set("Last-Modified", stat.mtime.toUTCString());
    }

    // 3. Handle HEAD request
    if (isHead) {
        finalHeaders.set("Content-Length", size.toString());
        console.log(`[${logPrefix}] HEAD ${path}`);
        return new Response(null, { status: 200, headers: finalHeaders });
    }

    // 4. Handle Range request
    const rangeHeader = req.headers.get("Range");
    const m = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);

    if (m) {
        const s = m[1] ? Number(m[1]) : 0;
        const e = m[2] ? Number(m[2]) : size - 1;

        if (s >= size) {
            // Range out of bounds
            finalHeaders.set("Content-Range", `bytes */${size}`);
            return new Response(null, { status: 416, headers: finalHeaders });
        }

        start = s;
        end = e < size ? e : size - 1;
        code = 206;
    }

    const length = end - start + 1;

    finalHeaders.set("Content-Length", length.toString());
    if (code === 206) {
        finalHeaders.set("Content-Range", `bytes ${start}-${end}/${size}`);
    }

    console.log(`[${logPrefix}] ${code} ${start}-${end}/${size} ${path}`);

    try {
        const file = await Deno.open(path, { read: true });

        let bytesSent = 0;

        if (start !== 0) {
            await file.seek(start, Deno.SeekMode.Start);
        }

        const limitedStream = file.readable.pipeThrough(new TransformStream({
            transform(chunk, controller) {
                const remaining = length - bytesSent;

                if (remaining <= 0) {
                    controller.terminate();
                    return;
                }

                if (chunk.byteLength > remaining) {
                    const slice = chunk.subarray(0, remaining);
                    controller.enqueue(slice);
                    bytesSent += slice.byteLength;
                    controller.terminate();
                } else {
                    controller.enqueue(chunk);
                    bytesSent += chunk.byteLength;
                }
            },
            flush() {
                file.close();
            }
        }));

        responseBody = limitedStream;

    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err ?? "");
        const name = err instanceof Error ? err.name : undefined;
        if (!msg.includes("Broken pipe") && !msg.includes("aborted") && name !== "AbortError") {
            console.error(`[${logPrefix}] stream error`, err);
        }
        return null;
    }

    return new Response(responseBody, {
        status: code,
        headers: finalHeaders,
    });
}