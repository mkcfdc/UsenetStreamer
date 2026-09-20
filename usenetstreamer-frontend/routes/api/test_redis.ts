import { createRedisClient } from "../../../shared/ioredis.ts";

const jsonStringify = (data: unknown) => {
    return JSON.stringify(data, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
    );
};

export const handler = {
    async POST(ctx: { req: Request }) {
        let client: ReturnType<typeof createRedisClient> | undefined;
        try {
            const body = await ctx.req.json();
            const { REDIS_URL } = body;

            if (!REDIS_URL) throw new Error("Missing REDIS_URL");

            try {
                new URL(REDIS_URL);
            } catch {
                throw new Error("Invalid URL format");
            }

            client = createRedisClient(REDIS_URL);

            const pong = await Promise.race([
                client.ping(),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("Connection timed out (5s)")), 5000)
                ),
            ]);

            await client.quit();
            client = undefined;

            if (pong !== "PONG") {
                throw new Error(`Unexpected response: ${pong}`);
            }

            return new Response(jsonStringify({
                success: true,
                message: "Successfully connected and PINGed Redis.",
            }), {
                headers: { "Content-Type": "application/json" },
            });
        } catch (error: unknown) {
            if (client) {
                try { client.disconnect(); } catch { /* ignore */ }
            }

            console.error("Redis Test Error:", error);

            return new Response(jsonStringify({
                success: false,
                message: error instanceof Error ? error.message : String(error),
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
    },
};
