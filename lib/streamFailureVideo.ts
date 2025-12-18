import { streamFileResponse } from "../utils/streamFileResponse.ts";
import { join } from "@std/path";
import { Config } from "../env.ts";

const FAILURE_VIDEO_PATH = join(
    Deno.cwd(),
    "public",
    "assets",
    Config.FAILURE_VIDEO_FILENAME
);

let cachedStats: Deno.FileInfo | null = null;
let lastStatCheck = 0;
const STAT_CACHE_TTL = 60_000 * 5;

export async function streamFailureVideo(
    req: Request,
    failureError?: unknown
): Promise<Response | null> {

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
            cachedStats = null;
            return null;
        }
    }

    if (!cachedStats.isFile) return null;

    let message = "NZBDav download failed";
    if (failureError) {
        if (typeof failureError === "string") {
            message = failureError;
        } else if (typeof failureError === "object") {
            const e = failureError as { failureMessage?: string; message?: string };
            message = e.failureMessage || e.message || String(failureError);
        }
    }

    const safeMessage = message.replace(/[\r\n\t]+/g, " ").substring(0, 500);

    const failureHeaders = new Headers({
        "X-NZBDav-Failure": safeMessage,
        "Access-Control-Allow-Origin": "*",
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
