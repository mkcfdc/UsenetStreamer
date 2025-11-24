import { define } from "../../utils.ts";
import { Context } from "fresh/server";

export const handler = define.handlers({
    async POST(ctx: Context) {
        try {
            const { url, api_key } = await ctx.req.json();

            if (!url || !api_key) {
                return new Response(JSON.stringify({ success: false, message: "URL and API Key are required." }), { status: 400 });
            }

            const baseUrl = url.replace(/\/+$/, "");
            const testUrl = `${baseUrl}/api?t=caps&apikey=${api_key}`;

            try {
                const res = await fetch(testUrl, {
                    headers: { "User-Agent": "UsenetStreamer/1.0" },
                    signal: AbortSignal.timeout(10000) // 10s timeout
                });

                if (!res.ok) {
                    // 401/403 usually means bad key
                    if (res.status === 401 || res.status === 403) {
                        return new Response(JSON.stringify({ success: false, message: "Auth Failed: Invalid API Key." }));
                    }
                    return new Response(JSON.stringify({ success: false, message: `HTTP Error: ${res.status} ${res.statusText}` }));
                }

                const text = await res.text();

                // Newznab returns XML by default. 
                // Simple check: does it look like XML and contain <caps>?
                if (text.includes("<caps>") || text.includes("<categories>")) {
                    return new Response(JSON.stringify({ success: true, message: "Connection Successful!" }));
                } else {
                    // Sometimes APIs return JSON errors even if XML is expected
                    return new Response(JSON.stringify({ success: false, message: "Invalid Response. Is this a Newznab indexer?" }));
                }

            } catch (error: any) {
                return new Response(JSON.stringify({ success: false, message: `Connection Failed: ${error.message}` }));
            }

        } catch (error: any) {
            return new Response(JSON.stringify({ success: false, message: "Internal Server Error" }), { status: 500 });
        }
    },
});
