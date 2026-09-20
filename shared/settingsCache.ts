import { SETTINGS_TTL_MS } from "./cacheKeys.ts";

interface CachedSetting {
    value: string;
    expires: number;
}

const cache = new Map<string, CachedSetting>();

export function getCachedSetting(key: string): string | undefined {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
        cache.delete(key);
        return undefined;
    }
    return hit.value;
}

export function setCachedSetting(key: string, value: string, ttlMs = SETTINGS_TTL_MS): void {
    cache.set(key, { value, expires: Date.now() + ttlMs });
}

export function invalidateSetting(key?: string): void {
    if (key) cache.delete(key);
    else cache.clear();
}
