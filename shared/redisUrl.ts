export interface RedisConnectionOptions {
    hostname: string;
    port: number;
    password?: string;
    username?: string;
    tls?: boolean;
}

/** Parse redis:// and rediss:// URLs for both ioredis and @db/redis. */
export function parseRedisUrl(raw: string): RedisConnectionOptions {
    const url = new URL(raw);
    return {
        hostname: url.hostname || "127.0.0.1",
        port: url.port ? Number(url.port) : 6379,
        password: url.password || undefined,
        username: url.username || undefined,
        tls: url.protocol === "rediss:",
    };
}
