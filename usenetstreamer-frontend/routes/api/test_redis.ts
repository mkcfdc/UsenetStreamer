import { Handlers } from "$fresh/server.ts";
import { connect } from "@db/redis";

export const handler: Handlers = {
    async POST(req) {
        try {
            const body = await req.json();
            const { REDIS_URL } = body;

            if (!REDIS_URL) {
                throw new Error("Missing REDIS_URL");
            }

            // 1. Parse the Connection String manually
            // (Native driver expects an object, not a string)
            let url: URL;
            try {
                url = new URL(REDIS_URL);
            } catch {
                throw new Error("Invalid URL format");
            }

            const options: any = {
                hostname: url.hostname,
                port: url.port ? parseInt(url.port) : 6379,
            };

            // Handle Auth
            if (url.password) options.password = url.password;
            if (url.username) options.username = url.username; // For ACL users

            // Handle TLS (rediss://)
            if (url.protocol === "rediss:") {
                options.tls = true;
                // If you use self-signed certs (e.g. internal docker), you might need to exclude this line
                // or ensure your container trusts the CA.
            }

            let redis;
            try {
                // 2. Connect with a strict 5-second timeout
                // We race the connection promise against a timer so the UI doesn't hang
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Connection timed out (5s)")), 5000)
                );

                redis = await Promise.race([
                    connect(options),
                    timeoutPromise
                ]) as any;

            } catch (err: any) {
                // If connection fails (e.g. wrong host), return the error message
                throw new Error(`Connection failed: ${err.message}`);
            }

            // 3. Ping and Close
            try {
                const pong = await redis.ping();
                await redis.close();

                if (pong !== "PONG") {
                    throw new Error(`Unexpected response: ${pong}`);
                }

                return new Response(JSON.stringify({
                    success: true,
                    message: "Successfully connected and PINGed Redis."
                }), { headers: { "Content-Type": "application/json" } });

            } catch (pingErr: any) {
                // Ensure we close if ping fails
                redis.close();
                throw pingErr;
            }

        } catch (error: any) {
            // Return 200 so the frontend can parse the JSON error message safely
            return new Response(JSON.stringify({
                success: false,
                message: error.message
            }), {
                headers: { "Content-Type": "application/json" }
            });
        }
    }
};
