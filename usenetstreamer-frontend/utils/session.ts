import { getRedis } from "../utils/redis.ts";

const SESSION_TTL_SEC = 86_400;
const PREFIX = "session:";

export interface SessionData {
    userId: number;
}

export const createSession = async (userId: number): Promise<string> => {
    const sessionId = crypto.randomUUID();
    const redis = await getRedis();
    await redis.setex(`${PREFIX}${sessionId}`, SESSION_TTL_SEC, userId.toString());
    return sessionId;
};

export const getSessionUser = async (sessionId: string): Promise<number | null> => {
    const redis = await getRedis();
    const userIdStr = await redis.get(`${PREFIX}${sessionId}`);
    if (!userIdStr) return null;
    return parseInt(userIdStr, 10);
};

export const deleteSession = async (sessionId: string): Promise<void> => {
    const redis = await getRedis();
    await redis.del(`${PREFIX}${sessionId}`);
};
