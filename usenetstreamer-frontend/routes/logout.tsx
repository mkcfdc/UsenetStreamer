import { deleteCookie, getCookies } from "@std/http/cookie";
import { define } from "../utils.ts";
import { deleteSession } from "../utils/session.ts";

export const handler = define.handlers({
    async GET(ctx) {
        const cookies = getCookies(ctx.req.headers);
        const sessionId = cookies.auth_session;

        if (sessionId) {
            // Remove from Redis/DB
            await deleteSession(sessionId);
        }

        const headers = new Headers();

        // Fix: Use the standard helper to reliably delete the cookie
        deleteCookie(headers, "auth_session", { path: "/" });

        headers.set("location", "/login");

        return new Response(null, {
            status: 303,
            headers,
        });
    },
});
