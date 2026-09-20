import { connect, type Redis } from "@db/redis";
import { getOrSetSetting } from "./sqlite.ts";
import { parseRedisUrl } from "../../shared/redisUrl.ts";

let client: Redis | null = null;
let connectedUrl: string | null = null;

function redisUrl(): string {
    return Deno.env.get("REDIS_URL") ||
        getOrSetSetting("REDIS_URL", "redis://redis:6379", "Connection string for Redis");
}

export async function getRedis(): Promise<Redis> {
    const url = redisUrl();
    if (client && connectedUrl === url) return client;

    if (client) {
        try { client.close(); } catch { /* ignore */ }
        client = null;
    }

    client = await connect(parseRedisUrl(url));
    connectedUrl = url;
    return client;
}
