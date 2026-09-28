import { getOrSetSetting } from "./sqlite.ts";
import { connectRawRedis } from "../../shared/redisRaw.ts";

function redisUrl(): string {
    return Deno.env.get("REDIS_URL") ||
        getOrSetSetting("REDIS_URL", "redis://redis:6379", "Connection string for Redis");
}

/**
 * Session helper. Fresh cannot ship ioredis (`require('./lib/modern')`
 * dies in the slim `_fresh` image). Talk RESP directly.
 */
export function getRedis() {
    const url = redisUrl();
    return {
        async setex(key: string, ttlSec: number, value: string) {
            const client = await connectRawRedis(url);
            try {
                return await client.send("SETEX", key, String(ttlSec), value);
            } finally {
                client.close();
            }
        },
        async get(key: string) {
            const client = await connectRawRedis(url);
            try {
                return await client.send("GET", key);
            } finally {
                client.close();
            }
        },
        async del(key: string) {
            const client = await connectRawRedis(url);
            try {
                return await client.send("DEL", key);
            } finally {
                client.close();
            }
        },
        disconnect() {},
        async quit() {},
    };
}

export async function closeRedis(): Promise<void> {
    // Per-command connections; nothing long-lived to close.
}
