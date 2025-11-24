import { Redis } from "ioredis";
import { REDIS_URL } from "../env.ts";

export const redis = new Redis(REDIS_URL);

// --- Event Listeners ---
redis.on("error", (err) => console.error(`%c[Redis] %cError: ${err}`, "color: red;", "color: orange;"));
redis.on("connect", () => console.log("%c[Redis] %cConnected", "color: red;", "color: green;"));
redis.on("ready", () => console.log("%c[Redis] %cReady", " color: red;", "color: green;"));
redis.on("reconnecting", () => console.log("%c[Redis] %cReconnecting...", "color: red;", "color: orange;"));
redis.on("close", () => console.warn("%c[Redis] Connection closed", "color: red;"));

/**
 * Sets a JSON value at a specific path in RedisJSON using a pipeline for efficiency.
 * @param key The Redis key.
 * @param path The JSONPath (e.g. '$' or '$.field').
 * @param data The data to store.
 * @param expirationSeconds Optional TTL in seconds.
 * @param mode Optional 'NX' (only set if not exists) or 'XX' (only set if exists).
 */
export async function setJsonValue<T>(
    key: string,
    path: string,
    data: T,
    expirationSeconds?: number,
    mode?: 'NX' | 'XX'
): Promise<boolean> {
    try {
        const pipeline = redis.pipeline();
        const args = [key, path, JSON.stringify(data)];
        if (mode) args.push(mode);

        // 1. Queue JSON.SET
        pipeline.call("JSON.SET", ...args);

        // 2. Queue EXPIRE if needed
        if (expirationSeconds && expirationSeconds > 0) {
            pipeline.expire(key, expirationSeconds);
        }

        // Execute both in one round-trip
        const results = await pipeline.exec();
        if (!results) return false;

        // Check result of JSON.SET (index 0)
        // ioredis pipeline result format: [[error, result], [error, result]]
        const [err, response] = results[0];

        if (err) throw err;
        return response === "OK";

    } catch (err) {
        console.error(`%c[Redis] %cFailed to set JSON for ${key}: ${err}`, "color: red;", "color: orange;");
        return false;
    }
}

/**
 * Gets and parses a JSON value from a specific path in RedisJSON.
 * Automatically unwraps the array format that RedisJSON returns for path queries.
 */
export async function getJsonValue<T>(
    key: string,
    path: string = '$'
): Promise<T | null> {
    try {
        const result = await redis.call('JSON.GET', key, path) as string | null;
        if (!result) return null;

        const parsed = JSON.parse(result);

        // RedisJSON `JSON.GET key path` returns an array [value].
        // We unwrap it to return the direct value T.
        if (Array.isArray(parsed)) {
            return parsed.length > 0 ? parsed[0] as T : null;
        }

        return parsed as T;
    } catch (e) {
        console.error(`%c[Redis] %cFailed to parse JSON for key ${key} at path ${path}. ${e}`, "color: red;", "color: orange;");
        return null;
    }
}

/**
 * Deletes a specific path within a JSON document.
 * @returns The number of paths deleted (usually 1 or 0).
 */
export async function deleteJsonPath(key: string, path: string): Promise<number> {
    try {
        const result = await redis.call("JSON.DEL", key, path);
        return Number(result);
    } catch (e) {
        console.error(`%c[Redis] %cError deleting path ${path} in ${key}: ${e}`, "color: red;", "color: orange;");
        return 0;
    }
}
