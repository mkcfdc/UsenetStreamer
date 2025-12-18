import { getCookies } from "@std/http/cookie";
import { define } from "../utils.ts";
import { getSessionUser } from "../utils/session.ts";
import { findUserById } from "../utils/db/users.ts";

export const handler = define.middleware(async (ctx) => {
    const cookies = getCookies(ctx.req.headers);
    const sessionId = cookies.auth_session;

    if (sessionId) {
        const userId = await getSessionUser(sessionId);

        if (userId) {
            const user = findUserById(userId);
            if (user) {
                ctx.state.user = user;
            }
        }
    }

    const url = ctx.url;

    const publicRoutes = ["/login", "/register", "/logout", "/configure"];

    const isPublic = publicRoutes.includes(url.pathname) ||
        url.pathname.startsWith("/_") ||
        url.pathname.includes(".");

    // Redirect if not logged in
    if (!ctx.state.user && !isPublic) {
        const headers = new Headers();
        headers.set("location", "/login");
        return new Response(null, { status: 303, headers });
    }

    // Redirect if logged in and trying to access Auth pages
    if (ctx.state.user && (url.pathname === "/login" || url.pathname === "/register")) {
        const headers = new Headers();
        headers.set("location", "/");
        return new Response(null, { status: 303, headers });
    }

    return await ctx.next();
});
