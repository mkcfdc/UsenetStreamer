import { pingRedis } from "../../../shared/redisRaw.ts";
import { getOrSetSetting, getEnabledIndexers } from "../../utils/sqlite.ts";

type Chip = { ok: boolean; label: string; detail: string };

async function checkRedis(url: string): Promise<Chip> {
    if (!url) return { ok: false, label: "Redis", detail: "Not configured" };
    try {
        await pingRedis(url, 3000);
        return { ok: true, label: "Redis", detail: "PONG" };
    } catch (e) {
        return { ok: false, label: "Redis", detail: e instanceof Error ? e.message : "Unreachable" };
    }
}

async function checkNzbDav(url: string, apiKey: string): Promise<Chip> {
    if (!url) return { ok: false, label: "NZBDav", detail: "Not configured" };
    try {
        const base = url.replace(/\/$/, "");
        const testUrl = `${base}/api?mode=version&apikey=${encodeURIComponent(apiKey || "")}&output=json`;
        const res = await fetch(testUrl, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return { ok: false, label: "NZBDav", detail: `HTTP ${res.status}` };
        const data = await res.json().catch(() => ({}));
        return { ok: true, label: "NZBDav", detail: data.version ? `v${data.version}` : "OK" };
    } catch (e) {
        return { ok: false, label: "NZBDav", detail: e instanceof Error ? e.message : "Unreachable" };
    }
}

async function checkIndexers(): Promise<Chip> {
    const method = getOrSetSetting("INDEXING_METHOD", "direct", "Indexing method");
    if (method === "prowlarr") {
        const url = getOrSetSetting("PROWLARR_URL", "", "");
        const key = getOrSetSetting("PROWLARR_API_KEY", "", "");
        if (!url || !key) return { ok: false, label: "Indexers", detail: "Prowlarr not set" };
        try {
            const res = await fetch(`${url.replace(/\/$/, "")}/api/v1/system/status?apikey=${encodeURIComponent(key)}`, {
                signal: AbortSignal.timeout(4000),
            });
            return res.ok
                ? { ok: true, label: "Indexers", detail: "Prowlarr OK" }
                : { ok: false, label: "Indexers", detail: `Prowlarr HTTP ${res.status}` };
        } catch (e) {
            return { ok: false, label: "Indexers", detail: e instanceof Error ? e.message : "Prowlarr down" };
        }
    }
    if (method === "nzbhydra2") {
        const url = getOrSetSetting("NZBHYDRA_URL", "", "");
        if (!url) return { ok: false, label: "Indexers", detail: "NZBHydra not set" };
        try {
            const res = await fetch(url.replace(/\/$/, ""), { signal: AbortSignal.timeout(4000) });
            return res.ok
                ? { ok: true, label: "Indexers", detail: "NZBHydra OK" }
                : { ok: false, label: "Indexers", detail: `Hydra HTTP ${res.status}` };
        } catch (e) {
            return { ok: false, label: "Indexers", detail: e instanceof Error ? e.message : "Hydra down" };
        }
    }

    const indexers = getEnabledIndexers();
    if (indexers.length === 0) return { ok: false, label: "Indexers", detail: "None enabled" };

    let ok = 0;
    await Promise.all(indexers.slice(0, 6).map(async (idx) => {
        try {
            const res = await fetch(
                `${idx.url.replace(/\/+$/, "")}/api?t=caps&apikey=${encodeURIComponent(idx.api_key)}`,
                { headers: { "User-Agent": "UsenetStreamer/1.0" }, signal: AbortSignal.timeout(4000) },
            );
            const text = res.ok ? await res.text() : "";
            if (res.ok && (text.includes("<caps>") || text.includes("<categories>"))) ok++;
        } catch { /* count as down */ }
    }));

    return {
        ok: ok > 0,
        label: "Indexers",
        detail: `${ok}/${indexers.length} reachable`,
    };
}

export const handler = {
    async GET() {
        const redisUrl = Deno.env.get("REDIS_URL") ||
            getOrSetSetting("REDIS_URL", "redis://redis:6379", "Connection string for Redis");
        const nzbUrl = getOrSetSetting("NZBDAV_URL", "", "");
        const nzbKey = getOrSetSetting("NZBDAV_API_KEY", "", "");

        const [redis, nzbdav, indexers] = await Promise.all([
            checkRedis(redisUrl),
            checkNzbDav(nzbUrl, nzbKey),
            checkIndexers(),
        ]);

        return new Response(JSON.stringify({ redis, nzbdav, indexers, checkedAt: Date.now() }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
    },
};
