import { streamFileResponse } from "../utils/streamFileResponse.ts";
import { join } from "@std/path";
import { Config } from "../env.ts";

const FAILURE_VIDEO_PATH = join(
    Deno.cwd(),
    "public",
    "assets",
    Config.FAILURE_VIDEO_FILENAME
);

// 1. Cache the file stats globally to avoid hitting the disk on every single failure.
// This makes serving the failure video almost instant.
let cachedStats: Deno.FileInfo | null = null;
let lastStatCheck = 0;
const STAT_CACHE_TTL = 60_000 * 5; // Re-check file existence every 5 minutes

export async function streamFailureVideo(
    req: Request,
    failureError?: unknown
): Promise<Response | null> {

    // 2. Lazy-load stats with TTL
    const now = Date.now();
    if (!cachedStats || (now - lastStatCheck > STAT_CACHE_TTL)) {
        try {
            cachedStats = await Deno.stat(FAILURE_VIDEO_PATH);
            lastStatCheck = now;
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                console.error(`[FAILURE STREAM] Video missing at: ${FAILURE_VIDEO_PATH}`);
                return null;
            }
            console.error(`[FAILURE STREAM] Stat error:`, error);
            // Reset cache to allow retry later
            cachedStats = null;
            return null;
        }
    }

    if (!cachedStats.isFile) return null;

    // 3. Extract and Sanitize Message
    let message = "NZBDav download failed";
    if (failureError) {
        if (typeof failureError === "string") {
            message = failureError;
        } else if (typeof failureError === "object") {
            // Handle NZBDavError or standard Error objects
            const e = failureError as any;
            message = e.failureMessage || e.message || String(failureError);
        }
    }

    // IMPORTANT: Headers cannot contain newlines or control characters.
    // We sanitize to safe ASCII and truncate to avoid header overflow.
    const safeMessage = message.replace(/[\r\n\t]+/g, " ").substring(0, 500);

    const failureHeaders = new Headers({
        "X-NZBDav-Failure": safeMessage,
        "Access-Control-Allow-Origin": "*",

        // 4. Prevent Cache Poisoning
        // Crucial: Tell the player NOT to cache this response.
        // Otherwise, the player might remember "Movie A = 5 second error video" 
        // and show the error again even after you fix the download.
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    });

    console.warn(`[FAILURE STREAM] Serving fallback: ${safeMessage}`);

    try {
        return await streamFileResponse(
            req,
            FAILURE_VIDEO_PATH,
            req.method === "HEAD",
            "FAILURE STREAM",
            cachedStats,
            failureHeaders
        );
    } catch (e) {
        console.error("[FAILURE STREAM] Failed to serve fallback video:", e);
        return null;
    }
}
