import { Redis } from "ioredis";
import { parseRedisUrl } from "./redisUrl.ts";

export interface CreateRedisOptions {
    onError?: (err: Error) => void;
    onConnect?: () => void;
    onReady?: () => void;
    onReconnecting?: () => void;
    onClose?: () => void;
}

/** Shared ioredis factory. Sessions and JSON scripts both use this. */
export function createRedisClient(url: string, hooks: CreateRedisOptions = {}): Redis {
    const parsed = parseRedisUrl(url);
    const client = new Redis({
        host: parsed.hostname,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
        tls: parsed.tls ? {} : undefined,
        enableReadyCheck: true,
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        lazyConnect: false,
        retryStrategy: (times) => Math.min(times * 100, 2000),
    });

    if (hooks.onError) client.on("error", hooks.onError);
    if (hooks.onConnect) client.on("connect", hooks.onConnect);
    if (hooks.onReady) client.on("ready", hooks.onReady);
    if (hooks.onReconnecting) client.on("reconnecting", hooks.onReconnecting);
    if (hooks.onClose) client.on("close", hooks.onClose);

    return client;
}
