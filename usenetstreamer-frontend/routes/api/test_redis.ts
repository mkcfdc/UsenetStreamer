import { Handlers } from "$fresh/server.ts";
import { connect } from "@db/redis";

const jsonStringify = (data: any) => {
    return JSON.stringify(data, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    );
};

export const handler: Handlers = {
    async POST(ctx) {
        let client;
        try {
            const body = await ctx.req.json();
            const { REDIS_URL } = body;

            if (!REDIS_URL) throw new Error("Missing REDIS_URL");

            // 2. Parse the Redis URL
            let url: URL;
            try {
                url = new URL(REDIS_URL);
            } catch {
                throw new Error("Invalid URL format");
            }

            const useTls = url.protocol === "rediss:";

            const options = {
                hostname: url.hostname,
                port: url.port ? parseInt(url.port) : 6379,
                password: url.password || undefined,
                username: url.username || undefined,
                tls: useTls,
            };
            console.log(options)

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Connection timed out (5s)")), 5000)
            );

            client = await Promise.race([
                connect(options),
                timeoutPromise
            ]) as Awaited<ReturnType<typeof connect>>;

            const pong = await client.ping();

            client.close();

            if (pong !== "PONG") {
                throw new Error(`Unexpected response: ${pong}`);
            }

            return new Response(jsonStringify({
                success: true,
                message: "Successfully connected and PINGed Redis."
            }), {
                headers: { "Content-Type": "application/json" }
            });

        } catch (error: any) {
            if (client) {
                try { client.close(); } catch { }
            }

            console.error("Redis Test Error:", error);

            return new Response(jsonStringify({
                success: false,
                message: error instanceof Error ? error.message : String(error)
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
    }
};