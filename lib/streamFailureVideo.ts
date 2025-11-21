import { streamFileResponse } from "../utils/streamFileResponse.ts";
import { join } from "@std/path";
import { FAILURE_VIDEO_FILENAME } from "../env.ts";

const FAILURE_VIDEO_PATH = join(
    Deno.cwd(),
    "public",
    "assets",
    FAILURE_VIDEO_FILENAME
);

export async function streamFailureVideo(
    req: Request,
    failureError?: unknown
): Promise<Response | null> {
    let stats: Deno.FileInfo;

    try {
        stats = await Deno.stat(FAILURE_VIDEO_PATH);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            console.error(
                `[FAILURE STREAM] Video not found: ${FAILURE_VIDEO_PATH}`
            );
            return null;
        }
        console.error(`[FAILURE STREAM] Stat error:`, error);
        return null;
    }

    if (!stats.isFile) return null;

    const failureMessage =
        (typeof failureError === "object" &&
            failureError !== null &&
            ("failureMessage" in failureError || "message" in failureError)
            ? (failureError as any).failureMessage || (failureError as any).message
            : null) || "NZBDav download failed";

    const failureHeaders = new Headers({
        "X-NZBDav-Failure": String(failureMessage),
        "Access-Control-Allow-Origin": "*",
    });

    console.warn(
        `[FAILURE STREAM] Serving fallback video: ${failureMessage}`
    );

    try {
        return await streamFileResponse(
            req,
            FAILURE_VIDEO_PATH,
            req.method === "HEAD",
            "FAILURE STREAM",
            stats,
            failureHeaders
        );
    } catch (e) {
        console.error("[FAILURE STREAM] Failed to serve fallback video:", e);
        return null;
    }
}
