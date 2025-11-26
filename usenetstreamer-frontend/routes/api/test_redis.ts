import { connect } from "@db/redis";

export const handler = async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
        const { REDIS_URL } = await req.json();

        if (!REDIS_URL) throw new Error("Missing REDIS_URL");

        let url: URL;
        try {
            url = new URL(REDIS_URL);
        } catch {
            throw new Error("Invalid URL format");
        }

        const isTls = url.protocol === "rediss:";
        const options: any = {
            hostname: url.hostname,
            port: url.port ? parseInt(url.port) : 6379,
        };

        if (url.password) options.password = url.password;
        if (url.username) options.username = url.username; // ACL support
        if (isTls) options.tls = true;

        // 2. Connect with a timeout logic (Native driver doesn't have connectTimeout option)
        // We race the connection against a 5s timer
        const redisPromise = connect(options);
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Connection timed out")), 5000)
        );

        const redis = await Promise.race([redisPromise, timeoutPromise]) as any;

        try {
            // 3. Ping
            const response = await redis.ping();

            if (response !== "PONG") throw new Error("Unexpected response");

            await redis.close();

            return new Response(JSON.stringify({
                success: true,
                message: "Successfully connected and PINGed Redis."
            }), { headers: { "Content-Type": "application/json" } });

        } catch (err: any) {
            redis.close();
            throw err;
        }

    } catch (error: any) {
        return new Response(JSON.stringify({
            success: false,
            message: "Connection Failed: " + error.message
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
};