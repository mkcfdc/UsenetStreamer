import { Redis } from "ioredis";
import { Config } from "../env.ts";
import {
    ACQUIRE_LOCK_SCRIPT,
    RELEASE_LOCK_SCRIPT,
    REMOVE_SEARCH_RESULT_SCRIPT,
    STREAM_STATUS_SCRIPT,
} from "../lib/redisScripts.ts";

const LOG = "%c[Redis]%c";
const LABEL = "color: #ff6b6b; font-weight: bold;";
const OK = "color: #51cf66;";
const WARN = "color: #fcc419;";
const ERR = "color: #ff922b;";

type JsonMode = "NX" | "XX";

export interface StreamStatus {
    status?: string;
    failureMessage?: string;
    nzoId?: string;
    viewPath?: string;
    fileName?: string;
}

interface RedisWithScripts extends Redis {
    acquireLockPx(key: string, token: string, ttlMs: number): Promise<[number, number]>;
    releaseLockToken(key: string, token: string): Promise<number>;
    removeSearchResult(key: string, downloadUrl: string): Promise<number>;
    streamStatus(key: string): Promise<string[] | null>;
}

let client: RedisWithScripts | null = null;
let connectingUrl: string | null = null;

function attachScripts(r: Redis): RedisWithScripts {
    r.defineCommand("acquireLockPx", { numberOfKeys: 1, lua: ACQUIRE_LOCK_SCRIPT });
    r.defineCommand("releaseLockToken", { numberOfKeys: 1, lua: RELEASE_LOCK_SCRIPT });
    r.defineCommand("removeSearchResult", { numberOfKeys: 1, lua: REMOVE_SEARCH_RESULT_SCRIPT });
    r.defineCommand("streamStatus", { numberOfKeys: 1, lua: STREAM_STATUS_SCRIPT });
    return r as RedisWithScripts;
}

function createClient(url: string): RedisWithScripts {
    const r = attachScripts(new Redis(url, {
        enableReadyCheck: true,
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        lazyConnect: false,
        retryStrategy: (times) => Math.min(times * 100, 2000),
    }));

    r.on("error", (err) => console.error(LOG, LABEL, ERR, `Error: ${err.message}`));
    r.on("connect", () => console.log(LOG, LABEL, OK, "Connected"));
    r.on("ready", () => console.log(LOG, LABEL, OK, "Ready"));
    r.on("reconnecting", () => console.log(LOG, LABEL, WARN, "Reconnecting..."));
    r.on("close", () => console.warn(LOG, LABEL, WARN, "Connection closed"));

    return r;
}

/** Live client. Recreates itself if REDIS_URL changes after a config save. */
export function getRedis(): RedisWithScripts {
    const url = Config.REDIS_URL;
    if (client && connectingUrl === url) return client;

    if (client) {
        client.disconnect();
        client = null;
    }

    connectingUrl = url;
    client = createClient(url);
    return client;
}

/** Back-compat singleton used by existing call sites. */
export const redis: RedisWithScripts = new Proxy({} as RedisWithScripts, {
    get(_target, prop, receiver) {
        const live = getRedis() as unknown as Record<PropertyKey, unknown>;
        const value = Reflect.get(live, prop, receiver);
        return typeof value === "function" ? value.bind(live) : value;
    },
});

export function parseRedisJson<T>(raw: unknown): T | undefined {
    if (raw == null) return undefined;
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) return (parsed[0] ?? undefined) as T | undefined;
        return parsed as T;
    } catch {
        return undefined;
    }
}

export async function setJsonValue<T>(
    key: string,
    path: string,
    data: T,
    expirationSeconds?: number,
    mode?: JsonMode,
): Promise<boolean> {
    const payload = JSON.stringify(data);
    const r = getRedis();

    try {
        if (expirationSeconds && expirationSeconds > 0) {
            const args: (string | number)[] = [key, path, payload];
            if (mode) args.push(mode);
            args.push("EX", expirationSeconds);
            try {
                return (await r.call("JSON.SET", ...args)) === "OK";
            } catch {
                const pipe = r.pipeline();
                const setArgs: (string | number)[] = [key, path, payload];
                if (mode) setArgs.push(mode);
                pipe.call("JSON.SET", ...setArgs);
                pipe.expire(key, expirationSeconds);
                const results = await pipe.exec();
                return results?.[0]?.[1] === "OK";
            }
        }

        const args: (string | number)[] = [key, path, payload];
        if (mode) args.push(mode);
        return (await r.call("JSON.SET", ...args)) === "OK";
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(LOG, LABEL, ERR, `SET ${key}: ${message}`);
        return false;
    }
}

export function setJsonValueAsync<T>(
    key: string,
    path: string,
    data: T,
    expirationSeconds?: number,
    mode?: JsonMode,
): void {
    setJsonValue(key, path, data, expirationSeconds, mode).catch(() => {});
}

export async function getJsonValue<T>(key: string, path = "$"): Promise<T | undefined> {
    try {
        const raw = await getRedis().call("JSON.GET", key, path);
        return parseRedisJson<T>(raw);
    } catch {
        return undefined;
    }
}

export async function getJsonValues<T>(keys: string[], path = "$"): Promise<(T | undefined)[]> {
    if (keys.length === 0) return [];
    try {
        const results = await getRedis().call("JSON.MGET", ...keys, path) as (string | null)[] | null;
        if (!results) return keys.map(() => undefined);
        return results.map((item) => parseRedisJson<T>(item));
    } catch {
        return keys.map(() => undefined);
    }
}

/** Merge fields into an existing document without wiping sibling keys. */
export async function mergeJson<T extends Record<string, unknown>>(
    key: string,
    data: T,
    expirationSeconds?: number,
): Promise<boolean> {
    const r = getRedis();
    const payload = JSON.stringify(data);
    try {
        const merged = await r.call("JSON.MERGE", key, "$", payload);
        if (expirationSeconds && expirationSeconds > 0) {
            await r.expire(key, expirationSeconds);
        }
        return merged === "OK";
    } catch {
        try {
            const pipe = r.pipeline();
            for (const [field, value] of Object.entries(data)) {
                pipe.call("JSON.SET", key, `$.${field}`, JSON.stringify(value));
            }
            if (expirationSeconds && expirationSeconds > 0) {
                pipe.expire(key, expirationSeconds);
            }
            await pipe.exec();
            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(LOG, LABEL, ERR, `MERGE ${key}: ${message}`);
            return false;
        }
    }
}

export async function deleteKey(...keyList: string[]): Promise<number> {
    if (keyList.length === 0) return 0;
    try {
        return await getRedis().del(...keyList);
    } catch {
        return 0;
    }
}

export function exists(key: string): Promise<boolean> {
    return getRedis().exists(key).then((n) => n === 1).catch(() => false);
}

export async function acquireLock(key: string, ttlMs: number, token: string): Promise<boolean> {
    try {
        const res = await getRedis().acquireLockPx(key, token, ttlMs);
        return Array.isArray(res) ? res[0] === 1 : false;
    } catch {
        const ok = await getRedis().set(key, token, "PX", ttlMs, "NX");
        return ok === "OK";
    }
}

export async function releaseLock(key: string, token: string): Promise<boolean> {
    try {
        return (await getRedis().releaseLockToken(key, token)) === 1;
    } catch {
        return false;
    }
}

export async function getStreamStatus(key: string): Promise<StreamStatus | null> {
    try {
        const res = await getRedis().streamStatus(key);
        if (!Array.isArray(res) || res.length === 0) return null;
        return {
            status: res[0] || undefined,
            failureMessage: res[1] || undefined,
            nzoId: res[2] || undefined,
            viewPath: res[3] || undefined,
            fileName: res[4] || undefined,
        };
    } catch {
        return getJsonValue<StreamStatus>(key) ?? null;
    }
}

export async function removeSearchHit(searchKey: string, downloadUrl: string): Promise<void> {
    try {
        await getRedis().removeSearchResult(searchKey, downloadUrl);
    } catch {
        // ignore
    }
}

export async function pingRedis(): Promise<boolean> {
    try {
        return (await getRedis().ping()) === "PONG";
    } catch {
        return false;
    }
}

export async function closeRedis(): Promise<void> {
    if (!client) return;
    await client.quit();
    client = null;
    connectingUrl = null;
    console.log(LOG, LABEL, OK, "Disconnected gracefully");
}
