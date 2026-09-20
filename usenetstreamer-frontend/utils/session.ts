import { getRedis } from "../utils/redis.ts";
import { keys, SESSION_TTL_SEC } from "../../shared/cacheKeys.ts";

export interface SessionData {
    userId: number;
}

export const createSession = async (userId: number): Promise<string> => {
    const sessionId = crypto.randomUUID();
    const redis = await getRedis();
    await redis.setex(keys.session(sessionId), SESSION_TTL_SEC, userId.toString());
    return sessionId;
};

export const getSessionUser = async (sessionId: string): Promise<number | null> => {
    const redis = await getRedis();
    const userIdStr = await redis.get(keys.session(sessionId));
    if (!userIdStr) return null;
    return parseInt(userIdStr, 10);
};

export const deleteSession = async (sessionId: string): Promise<void> => {
    const redis = await getRedis();
    await redis.del(keys.session(sessionId));
};
