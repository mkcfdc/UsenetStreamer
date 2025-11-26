import { Handlers } from "fresh/server.ts";
import Redis from "ioredis";

export const handler: Handlers = {
    async POST(req) {
        try {
            const body = await req.json();
            const { REDIS_URL } = body;

            if (!REDIS_URL) {
                return new Response(JSON.stringify({
                    success: false,
                    message: "Missing REDIS_URL"
                }), { headers: { "Content-Type": "application/json" } });
            }

            // Configure Redis client for a "One-off" test
            const redis = new Redis(REDIS_URL, {
                maxRetriesPerRequest: 0,
                connectTimeout: 5000,
                lazyConnect: true,
                retryStrategy: () => null
            });

            redis.on("error", () => { }); // Suppress console noise

            try {
                await redis.connect();
                const response = await redis.ping();

                if (response !== "PONG") {
                    throw new Error("Received unexpected response from Redis");
                }

                await redis.quit();

                return new Response(JSON.stringify({
                    success: true,
                    message: "Successfully connected and PINGed Redis."
                }), { headers: { "Content-Type": "application/json" } });

            } catch (connError: any) {
                redis.disconnect();
                return new Response(JSON.stringify({
                    success: false,
                    message: `Connection Failed: ${connError.message}`
                }), { headers: { "Content-Type": "application/json" } });
            }

        } catch (error: any) {
            return new Response(JSON.stringify({
                success: false,
                message: "Server Error: " + error.message
            }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
    }
};
