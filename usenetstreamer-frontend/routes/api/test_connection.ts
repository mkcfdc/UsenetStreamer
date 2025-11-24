// routes/api/test_manifest.ts
import { define } from "../../utils.ts";
import { Context } from "fresh/server";

export const handler = define.handlers({
    async POST(ctx: Context) {
        try {
            const { ADDON_BASE_URL, ADDON_SHARED_SECRET } = await ctx.req.json();

            if (!ADDON_BASE_URL || !ADDON_SHARED_SECRET) {
                return new Response(JSON.stringify({
                    success: false,
                    message: "Missing Base URL or Secret."
                }), { status: 400 });
            }

            // 1. Construct the Manifest URL
            // Remove trailing slashes from base URL to ensure clean path
            const baseUrl = ADDON_BASE_URL.replace(/\/+$/, "");
            const manifestUrl = `${baseUrl}/${ADDON_SHARED_SECRET}/manifest.json`;

            // 2. Fetch with Timeout
            // Stremio addons must respond quickly
            try {
                const res = await fetch(manifestUrl, {
                    headers: { "User-Agent": "UsenetStreamer-Tester/1.0" },
                    signal: AbortSignal.timeout(8000)
                });

                if (!res.ok) {
                    return new Response(JSON.stringify({
                        success: false,
                        message: `HTTP Error: ${res.status} ${res.statusText}`
                    }));
                }

                // 3. Validate Content Type
                const contentType = res.headers.get("content-type");
                if (!contentType || !contentType.includes("application/json")) {
                    return new Response(JSON.stringify({
                        success: false,
                        message: "Invalid Content-Type. Expected JSON. Check your Reverse Proxy settings."
                    }));
                }

                // 4. Validate JSON Structure
                const data = await res.json();
                if (data.id && data.version && data.name && data.resources) {
                    return new Response(JSON.stringify({
                        success: true,
                        message: `Verified: "${data.name}" v${data.version}`
                    }));
                } else {
                    return new Response(JSON.stringify({
                        success: false,
                        message: "Invalid Manifest JSON. Missing required fields (id, name, version, resources)."
                    }));
                }

            } catch (error: any) {
                // Handle Network/DNS errors
                return new Response(JSON.stringify({
                    success: false,
                    message: `Connection Failed: ${error.message}`
                }));
            }

        } catch (error: any) {
            console.error("Manifest Test Error:", error);
            return new Response(JSON.stringify({
                success: false,
                message: "Internal Server Error"
            }), { status: 500 });
        }
    },
});
