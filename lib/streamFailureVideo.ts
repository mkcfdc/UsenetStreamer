import { join } from "@std/path";
import { Config } from "../env.ts";

const FAILURE_VIDEO_PATH = join(
    Deno.cwd(),
    "public",
    "assets",
    Config.FAILURE_VIDEO_FILENAME
);

// Cache the entire video in memory for fast, reliable delivery
let cachedVideoData: Uint8Array | null = null;

async function ensureVideoCached(): Promise<boolean> {
    if (cachedVideoData) return true;

    try {
        const stats = await Deno.stat(FAILURE_VIDEO_PATH);
        if (!stats.isFile) return false;
        cachedVideoData = await Deno.readFile(FAILURE_VIDEO_PATH);
        console.log(`[FAILURE STREAM] Cached failure video: ${cachedVideoData.byteLength} bytes`);
        return true;
    } catch (e) {
        console.error(`[FAILURE STREAM] Failed to cache video:`, e);
        return false;
    }
}

function extractFailureMessage(failureError: unknown): string {
    if (!failureError) return "NZBDav download failed";

    if (typeof failureError === "string") return failureError;

    if (typeof failureError === "object") {
        const e = failureError as { failureMessage?: string; message?: string };
        return e.failureMessage || e.message || String(failureError);
    }

    return String(failureError);
}

export async function streamFailureVideo(
    req: Request,
    failureError?: unknown
): Promise<Response | null> {
    if (!await ensureVideoCached() || !cachedVideoData) {
        console.error("[FAILURE STREAM] Video not available");
        return null;
    }

    const message = extractFailureMessage(failureError);
    const safeMessage = message.replace(/[\r\n\t]+/g, " ").substring(0, 500);
    const size = cachedVideoData.byteLength;

    const headers = new Headers({
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "X-NZBDav-Failure": safeMessage,
        "Access-Control-Allow-Origin": "*",
        "Connection": "keep-alive",
    });

    // Handle HEAD request
    if (req.method === "HEAD") {
        headers.set("Content-Length", String(size));
        return new Response(null, { status: 200, headers });
    }

    // Parse range header
    const rangeHeader = req.headers.get("Range");
    let start = 0;
    let end = size - 1;
    let status = 200;

    if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
        if (match) {
            const [, startStr, endStr] = match;

            if (startStr && !endStr) {
                start = Number(startStr);
            } else if (!startStr && endStr) {
                start = Math.max(0, size - Number(endStr));
            } else if (startStr && endStr) {
                start = Number(startStr);
                end = Math.min(Number(endStr), size - 1);
            }

            if (start >= size || start > end) {
                headers.set("Content-Range", `bytes */${size}`);
                return new Response(null, { status: 416, headers });
            }

            status = 206;
            headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
        }
    }

    const contentLength = end - start + 1;
    headers.set("Content-Length", String(contentLength));

    // Serve from memory cache - slice the relevant portion
    const videoSlice = cachedVideoData.slice(start, end + 1);

    console.log(`[FAILURE STREAM] ${status} Range:${rangeHeader ?? "none"} -> ${start}-${end}/${size} (${contentLength} bytes)`);

    // Return slice directly - Response handles Uint8Array efficiently
    return new Response(videoSlice, { status, headers });
}