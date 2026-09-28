import "./utils/asciiArt.ts";

import { Config, validateConfig } from "./env.ts";
import { jsonResponse } from "./utils/responseUtils.ts";
import { routes } from "./routes/index.ts";
import { closeRedis } from "./utils/redis.ts";
import { closeDb } from "./utils/sqlite.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range",
    "Access-Control-Max-Age": "86400",
};

function handleCors(): Response {
    return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
    });
}

function handleRoot(): Response {
    return new Response(
        "Hello, the server is running! This is using the mkcfdc version of UsenetStreamer by Sanket9225.",
        { headers: { "Content-Type": "text/plain" } },
    );
}

async function handler(req: Request): Promise<Response> {
    const method = req.method;
    const url = new URL(req.url);

    if (method === "OPTIONS") {
        return handleCors();
    }

    if (url.pathname === "/" && method === "GET") {
        return handleRoot();
    }

    for (const route of routes) {
        const match = route.pattern.exec(url);
        if (match && route.methods.includes(method)) {
            try {
                return await route.handler(req, match);
            } catch (err) {
                console.error(`Route handler error for ${url.pathname}:`, err);
                return jsonResponse({ error: "Internal Server Error" }, 500);
            }
        }
    }

    return jsonResponse({ error: "Not found" }, 404);
}

function maintenanceHandler(): Response {
    return new Response(
        `[System Maintenance] Configuration required.\nMissing: ${validateConfig().join(", ")}\nUse the manage cli tool!`,
        { status: 503 },
    );
}

const port = Config.PORT;
let readyLogged = false;

function appHandler(req: Request): Promise<Response> | Response {
    const missing = validateConfig();
    if (missing.length > 0) {
        readyLogged = false;
        return maintenanceHandler();
    }
    if (!readyLogged) {
        readyLogged = true;
        console.log("✅ %cConfiguration valid. Serving requests...", "color: green");
        console.log(
            "Install url: ",
            `${Config.ADDON_BASE_URL.replace(/\/$/, "")}/${Config.ADDON_SHARED_SECRET}/manifest.json`,
        );
    }
    return handler(req);
}

const startupMissing = validateConfig();
if (startupMissing.length > 0) {
    console.error("❌ CRITICAL CONFIGURATION MISSING");
    console.error(`Missing: ${startupMissing.join(", ")}`);
    console.error("⚠️  Serving maintenance responses until config is saved.");
} else {
    readyLogged = true;
    console.log("✅ %cConfiguration valid. Starting application...", "color: green");
    console.log(
        "Install url: ",
        `${Config.ADDON_BASE_URL.replace(/\/$/, "")}/${Config.ADDON_SHARED_SECRET}/manifest.json`,
    );
}

Deno.serve({ port }, appHandler);

async function shutdown() {
    try { await closeRedis(); } catch { /* ignore */ }
    try { closeDb(); } catch { /* ignore */ }
}

Deno.addSignalListener("SIGINT", () => {
    shutdown().finally(() => Deno.exit(0));
});
Deno.addSignalListener("SIGTERM", () => {
    shutdown().finally(() => Deno.exit(0));
});
