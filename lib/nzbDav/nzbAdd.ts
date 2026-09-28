import { Config } from "../../env.ts";
import { fetcher } from "../../utils/fetcher.ts";
import { decodeNzbBytes, inspectNzbBytes, isGzipNzb } from "../../utils/nzbEfficiency.ts";
import { buildNzbdavApiParams } from "./nzbUtils.ts";

export class NzbdavError extends Error {
    readonly isNzbdavFailure = true;
    constructor(
        message: string,
        public readonly failureMessage: string,
        public readonly nzoId?: string,
        public readonly category?: string,
    ) {
        super(message);
    }
}

export function nzoIdFrom(json: any): string | undefined {
    return json?.nzo_ids?.[0] || json?.nzoId || json?.nzo_id;
}

const now = performance.now.bind(performance);
const dur = (start: number) => (performance.now() - start).toFixed(0);
const timestamp = () => new Date().toISOString().slice(11, -1);
const log = (scope: string, msg: string, ...args: unknown[]) =>
    console.log(`[${timestamp()}] [${scope}] ${msg}`, ...args);

export async function addNzbFile(
    downloadUrl: string,
    category: string,
    jobName: string,
): Promise<string | null> {
    const t0 = now();
    const nzbRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!nzbRes.ok) {
        log("NZB", `addfile fetch ${nzbRes.status} from indexer`);
        await nzbRes.body?.cancel();
        return null;
    }
    const raw = new Uint8Array(await nzbRes.arrayBuffer());
    if (raw.byteLength < 64) {
        log("NZB", `addfile body too small (${raw.byteLength}b)`);
        return null;
    }

    let upload = raw;
    try {
        const structure = await inspectNzbBytes(raw);
        if (!structure.usable) {
            throw new NzbdavError(
                "Unusable NZB: no files/segments",
                "NZB is empty, HTML, or missing files/segments",
            );
        }
        log(
            "NZB",
            `structure files=${structure.fileCount} segs=${structure.segmentCount} ` +
                `video=${structure.videoFileCount} rar=${structure.archiveFileCount} ` +
                `direct=${structure.likelyDirectVideo}`,
        );
        if (isGzipNzb(raw)) {
            upload = new TextEncoder().encode(await decodeNzbBytes(raw));
        }
    } catch (e) {
        if (e instanceof NzbdavError) throw e;
        log("NZB", `structure scan skipped: ${e instanceof Error ? e.message : e}`);
    }

    const form = new FormData();
    form.append("name", new Blob([upload], { type: "application/x-nzb" }), `${jobName}.nzb`);

    const url = new URL(`${Config.NZBDAV_URL.replace(/\/$/, "")}/api`);
    url.searchParams.set("mode", "addfile");
    url.searchParams.set("apikey", Config.NZBDAV_API_KEY);
    url.searchParams.set("cat", category);
    url.searchParams.set("nzbname", jobName);
    url.searchParams.set("output", "json");

    const res = await fetch(url, {
        method: "POST",
        body: form,
        headers: { "X-API-KEY": Config.NZBDAV_API_KEY || "" },
        signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json().catch(() => null);
    const nzoId = nzoIdFrom(json);
    if (!nzoId) {
        log("NZB", `addfile rejected: ${JSON.stringify(json)}`);
        return null;
    }
    log("NZB", `NZB added via addfile. ID: ${nzoId}. ${upload.byteLength}b in ${dur(t0)}ms`);
    return nzoId;
}

export async function addNzbToNzbdav(
    nzbUrl: string,
    category: string,
    jobName: string,
    downloadUrl?: string,
): Promise<string> {
    if (!nzbUrl && !downloadUrl) throw new Error("Missing NZB URL");
    const t0 = now();

    if (downloadUrl) {
        try {
            const viaFile = await addNzbFile(downloadUrl, category, jobName);
            if (viaFile) return viaFile;
            log("NZB", "addfile returned empty nzo, falling back to addurl");
        } catch (e) {
            if (e instanceof NzbdavError) throw e;
            log("NZB", `addfile fallback to addurl: ${e instanceof Error ? e.message : e}`);
        }
    } else {
        log("NZB", "no downloadUrl on stream meta, addurl only");
    }

    log("NZB", `Adding URL to category: ${category} (${nzbUrl})`);
    const json = await fetcher<any>(`${Config.NZBDAV_URL}/api`, {
        params: buildNzbdavApiParams("addurl", { name: nzbUrl, cat: category, nzbname: jobName }),
        timeoutMs: Config.NZBDAV_API_TIMEOUT_MS ?? 10000,
        headers: { "X-API-KEY": Config.NZBDAV_API_KEY || "" },
    });
    const nzoId = nzoIdFrom(json);

    if (!nzoId) {
        log("NZB", `Add fail dump: ${JSON.stringify(json)}`);
        throw new Error("[NZBDAV] Failed to queue NZB");
    }
    log("NZB", `NZB Added. ID: ${nzoId}. Took ${dur(t0)}ms`);
    return nzoId;
}
