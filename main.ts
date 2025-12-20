import "./utils/asciiArt.ts";

import { Config, validateConfig } from "./env.ts";
import { jsonResponse } from "./utils/responseUtils.ts";
import { routes } from "./routes/index.ts";

// --- CORS HEADERS ---
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range",
    "Access-Control-Max-Age": "86400",
};

// --- CORS OPTIONS HANDLER ---
function handleCors(): Response {
    return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
    });
}

// --- ROOT HANDLER ---
function handleRoot(): Response {
    return new Response(
        "Hello, the server is running! This is using the mkcfdc version of UsenetStreamer by Sanket9225.",
        { headers: { "Content-Type": "text/plain" } },
    );
}

// --- MAIN HANDLER ---
async function handler(req: Request): Promise<Response> {
    const method = req.method;
    const url = new URL(req.url);

    // --- GLOBAL CORS (OPTIONS) ---
    if (method === "OPTIONS") {
        return handleCors();
    }

    // --- ROOT CHECK ---
    if (url.pathname === "/" && method === "GET") {
        return handleRoot();
    }

    // --- ROUTE MATCHING ---
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

    // --- 404 NOT FOUND ---
    return jsonResponse({ error: "Not found" }, 404);
}

// --- MAINTENANCE MODE HANDLER ---
function maintenanceHandler(): Response {
    return new Response(
        `[System Maintenance] Configuration required.\nMissing: ${validateConfig().join(", ")}\nUse the manage cli tool!`,
        { status: 503 },
    );
}

// --- BOOTSTRAP ---
const missingKeys = validateConfig();
const port = Config.PORT;

if (missingKeys.length > 0) {
    console.error("❌ CRITICAL CONFIGURATION MISSING");
    console.error(`Missing: ${missingKeys.join(", ")}`);
    console.error("⚠️  Server started in MAINTENANCE MODE. Run: manage");

    Deno.serve({ port }, maintenanceHandler);
} else {
    console.log("✅ %cConfiguration valid. Starting application...", "color: green");
    console.log(
        "Install url: ",
        `${Config.ADDON_BASE_URL.replace(/\/$/, "")}/${Config.ADDON_SHARED_SECRET}/manifest.json`,
    );
    Deno.serve({ port }, handler);
}
