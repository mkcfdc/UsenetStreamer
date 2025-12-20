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
 * Sets a JSON value with optional expiration. Uses pipeline for atomic operation.
 */
export function setJsonValue<T>(
    key: string,
    path: string,
    data: T,
    expirationSeconds?: number,
    mode?: "NX" | "XX",
): Promise<boolean> {
    const pipeline = redis.pipeline();

    // Build args array
    const args: (string | number)[] = [key, path, JSON.stringify(data)];
    if (mode) args.push(mode);

    pipeline.call("JSON.SET", ...args);

    if (expirationSeconds && expirationSeconds > 0) {
        pipeline.expire(key, expirationSeconds);
    }

    return pipeline.exec().then(
        (results) => results?.[0]?.[1] === "OK",
        (err) => {
            console.error(LOG_PREFIX, STYLE_LABEL, STYLE_ERR, `SET ${key}: ${err.message}`);
            return false;
        }
    );
}

/**
 * Sets JSON value without waiting - fire and forget.
 * Use when you don't need confirmation (e.g., caching).
 */
export function setJsonValueAsync<T>(
    key: string,
    path: string,
    data: T,
    expirationSeconds?: number,
): void {
    const pipeline = redis.pipeline();
    pipeline.call("JSON.SET", key, path, JSON.stringify(data));
    if (expirationSeconds) pipeline.expire(key, expirationSeconds);
    pipeline.exec().catch(() => { }); // Swallow errors silently
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

        // Unwrap RedisJSON array wrapper
        return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
        return undefined;
    }
}

/**
 * Batch get multiple JSON keys in one round-trip.
 */
export async function getJsonValues<T>(
    keys: string[],
    path = "$",
): Promise<(T | undefined)[]> {
    if (keys.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const key of keys) {
        pipeline.call("JSON.GET", key, path);
    }

    const results = await pipeline.exec();
    if (!results) return new Array(keys.length).fill(undefined);

    return results.map(([err, result]) => {
        if (err || !result) return undefined;
        try {
            const parsed = JSON.parse(result as string);
            return Array.isArray(parsed) ? parsed[0] : parsed;
        } catch {
            return undefined;
        }
    });
}

/**
 * Batch set multiple JSON key-value pairs in one round-trip.
 */
export function setJsonValues<T>(
    entries: Array<{ key: string; data: T; ttl?: number }>,
    path = "$",
): Promise<boolean[]> {
    if (entries.length === 0) return Promise.resolve([]);

    const pipeline = redis.pipeline();

    for (const { key, data, ttl } of entries) {
        pipeline.call("JSON.SET", key, path, JSON.stringify(data));
        if (ttl) pipeline.expire(key, ttl);
    }

    return pipeline.exec().then(
        (results) => {
            if (!results) return entries.map(() => false);

            // Every other result is the JSON.SET (if TTL was set)
            const out: boolean[] = [];
            let i = 0;
            for (const entry of entries) {
                out.push(results[i]?.[1] === "OK");
                i += entry.ttl ? 2 : 1;
            }
            return out;
        },
        () => entries.map(() => false)
    );
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
 * Check if a key exists (faster than GET for existence checks).
 */
export function exists(key: string): Promise<boolean> {
    return redis.exists(key).then((r) => r === 1);
}

/**
 * Check multiple keys exist in one round-trip.
 */
export function existsMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return Promise.resolve(0);
    return redis.exists(...keys);
}

/**
 * Set with lock pattern - returns true if lock acquired.
 */
export function acquireLock(
    key: string,
    ttlSeconds: number,
): Promise<boolean> {
    return redis.set(key, "1", "EX", ttlSeconds, "NX").then((r) => r === "OK");
}

/**
 * Release a lock.
 */
export function releaseLock(key: string): Promise<void> {
    return redis.del(key).then(() => { });
}

/**
 * Graceful shutdown.
 */
export async function closeRedis(): Promise<void> {
    await redis.quit();
    console.log(LOG_PREFIX, STYLE_LABEL, STYLE_OK, "Disconnected gracefully");
}
