import { redis } from "../utils/redis.ts";

// Session Time-To-Live in seconds (e.g., 24 hours)
const SESSION_TTL = 60 * 60 * 24;

// The key prefix makes it easy to identify session keys in Redis CLI
const PREFIX = "session:";

export interface SessionData {
    userId: number;
}

/**
 * Creates a session for a specific user.
 * Generates a random UUID, saves it to Redis, and returns the Session ID.
 */
export const createSession = async (userId: number): Promise<string> => {
    const sessionId = crypto.randomUUID(); // Built-in Web API
    const redisKey = `${PREFIX}${sessionId}`;

    // Store the user ID as a string. 
    // We use 'EX' to set the expiration time atomically.
    await redis.setex(redisKey, SESSION_TTL, userId.toString());

    return sessionId;
};

/**
 * Retrieves the User ID associated with a Session ID.
 * Returns null if the session does not exist or has expired.
 */
export const getSessionUser = async (sessionId: string): Promise<number | null> => {
    const redisKey = `${PREFIX}${sessionId}`;
    const userIdStr = await redis.get(redisKey);

    if (!userIdStr) return null;

    return parseInt(userIdStr, 10);
};

/**
 * Destroys a session (used for logging out).
 */
export const deleteSession = async (sessionId: string): Promise<void> => {
    const redisKey = `${PREFIX}${sessionId}`;
    await redis.del(redisKey);
};
