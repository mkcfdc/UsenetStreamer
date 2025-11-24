import { define } from "../../utils.ts";
import { Context } from "fresh/server";

export const handler = define.handlers({
    async POST(ctx: Context) {
        try {
            const body = await ctx.req.json();
            const {
                NZBDAV_URL,
                NZBDAV_API_KEY,
                NZBDAV_WEBDAV_URL,
                NZBDAV_WEBDAV_USER,
                NZBDAV_WEBDAV_PASS
            } = body;

            const results = {
                nzbdav: { success: false, message: "" },
                webdav: { success: false, message: "" },
            };

            // 1. Test NZBDav (SABnzbd compatible API)
            try {
                // Standard SABnzbd version check
                // Handle URLs with or without trailing slash
                const baseUrl = NZBDAV_URL.replace(/\/$/, "");
                const testUrl = `${baseUrl}/api?mode=version&apikey=${NZBDAV_API_KEY}&output=json`;

                const res = await fetch(testUrl, { signal: AbortSignal.timeout(5000) });

                if (res.ok) {
                    const data = await res.json();
                    // SABnzbd API usually returns a version string or object. 
                    // If we got JSON and a 200 OK, we are good.
                    if (data.version || data.status !== false) {
                        results.nzbdav.success = true;
                        results.nzbdav.message = "Connected (Version: " + (data.version || "Unknown") + ")";
                    } else {
                        results.nzbdav.message = "API responded but returned error: " + (data.error || "Unknown");
                    }
                } else {
                    results.nzbdav.message = `HTTP Error: ${res.status} ${res.statusText}`;
                }
            } catch (error: any) {
                results.nzbdav.message = error.message || "Connection Failed";
            }

            // 2. Test WebDAV
            try {
                // Basic Auth Header
                const auth = btoa(`${NZBDAV_WEBDAV_USER}:${NZBDAV_WEBDAV_PASS}`);

                // Use PROPFIND (standard WebDAV check) or GET
                const res = await fetch(NZBDAV_WEBDAV_URL, {
                    method: "PROPFIND", // Or 'GET' if PROPFIND fails on specific server
                    headers: {
                        "Authorization": `Basic ${auth}`,
                        "Depth": "0" // Check just the root folder
                    },
                    signal: AbortSignal.timeout(5000)
                });

                if (res.ok || res.status === 207) { // 207 Multi-Status is success for WebDAV
                    results.webdav.success = true;
                    results.webdav.message = "Connection Successful";
                } else if (res.status === 401) {
                    results.webdav.message = "Authentication Failed (401)";
                } else {
                    results.webdav.message = `HTTP Error: ${res.status} ${res.statusText}`;
                }
            } catch (error: any) {
                results.webdav.message = error.message || "Connection Failed";
            }

            return new Response(JSON.stringify(results), {
                headers: { "Content-Type": "application/json" },
            });

        } catch (error: any) {
            console.error("Test Connection Error:", error);
            return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }
    },
});
