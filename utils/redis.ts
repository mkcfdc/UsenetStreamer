import { Redis } from "ioredis";
import { Config } from "../env.ts";

// ═══════════════════════════════════════════════════════════════════
// Constants & Initialization
// ═══════════════════════════════════════════════════════════════════

const LOG_PREFIX = "%c[Redis]%c";
const STYLE_LABEL = "color: #ff6b6b; font-weight: bold;";
const STYLE_OK = "color: #51cf66;";
const STYLE_WARN = "color: #fcc419;";
const STYLE_ERR = "color: #ff922b;";

export const redis = new Redis(Config.REDIS_URL, {
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 50, 2000),
    enableOfflineQueue: true,
});

redis
    .on("error", (err) => console.error(LOG_PREFIX, STYLE_LABEL, STYLE_ERR, `Error: ${err.message}`))
    .on("connect", () => console.log(LOG_PREFIX, STYLE_LABEL, STYLE_OK, "Connected"))
    .on("ready", () => console.log(LOG_PREFIX, STYLE_LABEL, STYLE_OK, "Ready"))
    .on("reconnecting", () => console.log(LOG_PREFIX, STYLE_LABEL, STYLE_WARN, "Reconnecting..."))
    .on("close", () => console.warn(LOG_PREFIX, STYLE_LABEL, STYLE_WARN, "Connection closed"));

// ═══════════════════════════════════════════════════════════════════
// Core Operations
// ═══════════════════════════════════════════════════════════════════

/**
 * Sets a JSON value with optional expiration.
 * Bypasses pipeline overhead when TTL is not required.
 */
export async function setJsonValue<T>(
    key: string,
    path: string,
    data: T,
    expirationSeconds?: number,
    mode?: "NX" | "XX",
): Promise<boolean> {
    const args: (string | number)[] = [key, path, JSON.stringify(data)];
    if (mode) args.push(mode);

    try {
        if (expirationSeconds && expirationSeconds > 0) {
            // Pipeline only when we genuinely need to chain commands
            const pipeline = redis.pipeline();
            pipeline.call("JSON.SET", ...args);
            pipeline.expire(key, expirationSeconds);
            const results = await pipeline.exec();
            return results?.[0]?.[1] === "OK";
        } else {
            // Fast-path direct execution
            const result = await redis.call("JSON.SET", ...args);
            return result === "OK";
        }
    } catch (err: any) {
        console.error(LOG_PREFIX, STYLE_LABEL, STYLE_ERR, `SET ${key}: ${err.message}`);
        return false;
    }
}

/**
 * Sets JSON value without waiting - fire and forget.
 */
export function setJsonValueAsync<T>(
    key: string,
    path: string,
    data: T,
    expirationSeconds?: number,
): void {
    const jsonStr = JSON.stringify(data);

    if (expirationSeconds && expirationSeconds > 0) {
        const pipeline = redis.pipeline();
        pipeline.call("JSON.SET", key, path, jsonStr);
        pipeline.expire(key, expirationSeconds);
        pipeline.exec().catch(() => { });
    } else {
        // Fast-path fire-and-forget
        redis.call("JSON.SET", key, path, jsonStr).catch(() => { });
    }
}

/**
 * Gets and parses a JSON value. Returns undefined on miss for easier nullish coalescing.
 */
export async function getJsonValue<T>(
    key: string,
    path = "$",
): Promise<T | undefined> {
    try {
        const result = await redis.call("JSON.GET", key, path) as string | null;
        if (!result) return undefined;

        const parsed = JSON.parse(result);
        return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
        return undefined;
    }
}

/**
 * Batch get multiple JSON keys in ONE single round-trip.
 * Uses native JSON.MGET, significantly faster than pipelining JSON.GET.
 */
export async function getJsonValues<T>(
    keys: string[],
    path = "$",
): Promise<(T | undefined)[]> {
    if (keys.length === 0) return [];

    try {
        // JSON.MGET format: JSON.MGET key1 key2 ... keyN path
        const args = [...keys, path];
        const results = await redis.call("JSON.MGET", ...args) as (string | null)[];

        if (!results) return new Array(keys.length).fill(undefined);

        return results.map((result) => {
            if (!result) return undefined;
            try {
                const parsed = JSON.parse(result);
                return Array.isArray(parsed) ? parsed[0] : parsed;
            } catch {
                return undefined;
            }
        });
    } catch {
        return new Array(keys.length).fill(undefined);
    }
}

/**
 * Batch set multiple JSON key-value pairs in one round-trip.
 */
export async function setJsonValues<T>(
    entries: Array<{ key: string; data: T; ttl?: number }>,
    path = "$",
): Promise<boolean[]> {
    if (entries.length === 0) return [];

    const pipeline = redis.pipeline();

    for (let i = 0; i < entries.length; i++) {
        const { key, data, ttl } = entries[i];
        pipeline.call("JSON.SET", key, path, JSON.stringify(data));
        if (ttl && ttl > 0) pipeline.expire(key, ttl);
    }

    try {
        const results = await pipeline.exec();
        if (!results) return entries.map(() => false);

        const out: boolean[] = [];
        let resultIdx = 0;

        for (let i = 0; i < entries.length; i++) {
            out.push(results[resultIdx]?.[1] === "OK");
            // Advance pointer by 2 if TTL was added, else 1
            resultIdx += (entries[i].ttl && entries[i].ttl! > 0) ? 2 : 1;
        }
        return out;
    } catch {
        return entries.map(() => false);
    }
}

/**
 * Deletes a specific path within a JSON document.
 */
export function deleteJsonPath(key: string, path: string): Promise<number> {
    return redis.call("JSON.DEL", key, path).then(
        (result) => Number(result),
        () => 0
    );
}

/**
 * Check if a key exists.
 */
export function exists(key: string): Promise<boolean> {
    return redis.exists(key).then((r) => r === 1);
}

/**
 * Check multiple keys exist in one round-trip.
 */
export function existsMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return Promise.resolve(0);
    // Passing the array directly bypasses V8's call stack limits 
    // that would occur if you used '...keys' on an array > 65k items.
    return redis.exists(keys);
}

/**
 * Set with safe distributed lock pattern.
 * Requires a unique token (e.g. UUID) to prevent accidentally releasing someone else's lock.
 */
export function acquireLock(
    key: string,
    ttlSeconds: number,
    token: string
): Promise<boolean> {
    return redis.set(key, token, "EX", ttlSeconds, "NX").then((r) => r === "OK");
}

/**
 * Safe lock release via atomic Lua Script. 
 * Only releases if the lock is still owned by the provided token.
 */
export function releaseLock(key: string, token: string): Promise<boolean> {
    const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
        else
            return 0
        end
    `;
    return redis.eval(script, 1, key, token).then((r) => r === 1);
}

/**
 * Graceful shutdown.
 */
export async function closeRedis(): Promise<void> {
    await redis.quit();
    console.log(LOG_PREFIX, STYLE_LABEL, STYLE_OK, "Disconnected gracefully");
}
