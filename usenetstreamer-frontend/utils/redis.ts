import { connect, type Redis } from "@db/redis";
import { getOrSetSetting } from "./sqlite.ts";

let client: Redis | null = null;
let connectedUrl: string | null = null;

function redisUrl(): string {
    return Deno.env.get("REDIS_URL") ||
        getOrSetSetting("REDIS_URL", "redis://redis:6379", "Connection string for Redis");
}

function parseRedisUrl(raw: string): {
    hostname: string;
    port: number;
    password?: string;
    username?: string;
    tls?: boolean;
} {
    const url = new URL(raw);
    return {
        hostname: url.hostname || "127.0.0.1",
        port: url.port ? Number(url.port) : 6379,
        password: url.password || undefined,
        username: url.username || undefined,
        tls: url.protocol === "rediss:",
    };
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
