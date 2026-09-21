import type { Redis } from "ioredis";
import { getOrSetSetting } from "./sqlite.ts";
import { createRedisClient } from "../../shared/ioredis.ts";

let client: Redis | null = null;
let connectedUrl: string | null = null;

function redisUrl(): string {
    return Deno.env.get("REDIS_URL") ||
        getOrSetSetting("REDIS_URL", "redis://redis:6379", "Connection string for Redis");
}

/** Session client. Same factory as the addon; no RedisJSON commands. */
export function getRedis(): Redis {
    const url = redisUrl();
    if (client && connectedUrl === url) return client;

    if (client) {
        try { client.disconnect(); } catch { /* ignore */ }
        client = null;
    }

    client = createRedisClient(url);
    connectedUrl = url;
    return client;
}

export async function closeRedis(): Promise<void> {
    if (!client) return;
    await client.quit();
    client = null;
    connectedUrl = null;
}
