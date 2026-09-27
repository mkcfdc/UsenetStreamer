import { pingRedis } from "../../../shared/redisRaw.ts";

const jsonStringify = (data: unknown) => {
    return JSON.stringify(data, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
    );
};

export const handler = {
    async POST(ctx: { req: Request }) {
        try {
            const body = await ctx.req.json();
            const { REDIS_URL } = body;

            if (!REDIS_URL) throw new Error("Missing REDIS_URL");

            try {
                new URL(REDIS_URL);
            } catch {
                throw new Error("Invalid URL format");
            }

            if (!REDIS_URL.startsWith("redis://") && !REDIS_URL.startsWith("rediss://")) {
                throw new Error("URL must start with redis:// or rediss://");
            }

            await pingRedis(REDIS_URL, 5000);

            return new Response(jsonStringify({
                success: true,
                message: "Successfully connected and PINGed Redis.",
            }), {
                headers: { "Content-Type": "application/json" },
            });
        } catch (error: unknown) {
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
