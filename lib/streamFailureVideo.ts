import { streamFileResponse } from "../utils/streamFileResponse.ts";
import { resolve } from "@std/path/posix";
import { FAILURE_VIDEO_FILENAME } from "../env.ts";

const FAILURE_VIDEO_PATH = resolve(
    Deno.cwd(),
    "public",
    "assets",
    FAILURE_VIDEO_FILENAME
);

async function safeStat(filePath: string): Promise<Deno.FileInfo | null> {
    try {
        return await Deno.stat(filePath);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            return null;
        }
        throw error;
    }
}

export async function streamFailureVideo(req: Request, failureError?: any): Promise<Response | null> {

    const stats = await safeStat(FAILURE_VIDEO_PATH);
    if (!stats || !stats.isFile) {
        console.error(
            `[FAILURE STREAM] Failure video not found at ${FAILURE_VIDEO_PATH}`
        );
        return null;
    }

    const emulateHead = req.method.toUpperCase() === "HEAD";
    const failureMessage =
        failureError?.failureMessage ||
        failureError?.message ||
        "NZBDav download failed";

    const failureHeaders = new Headers();
    failureHeaders.set("X-NZBDav-Failure", failureMessage);
    failureHeaders.set("Access-Control-Allow-Origin", "*");

    console.warn(
        `[FAILURE STREAM] Serving fallback video due to NZBDav failure: ${failureMessage}`
    );

    try {
        return await streamFileResponse(
            req,
            FAILURE_VIDEO_PATH,
            emulateHead,
            "FAILURE STREAM",
            stats,
            failureHeaders
        );
    } catch (e) {
        console.error("[FAILURE STREAM] Failed to serve fallback video:", e);
        return null;
    }
}