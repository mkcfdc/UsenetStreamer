import { setCookie } from "@std/http/cookie";

import { page } from "fresh";
import { define } from "../utils.ts";
import { findUserByEmail } from "../utils/db/users.ts";
import { comparePassword } from "../utils/security.ts";
import { createSession } from "../utils/session.ts";

interface Data {
    error?: string;
}

export const handler = define.handlers<Data>({
    async POST(ctx) {
        const form = await ctx.req.formData();
        const email = form.get("email")?.toString();
        const password = form.get("password")?.toString();

        const errorMsg = "Invalid email or password";

        if (!email || !password) {
            return page({ error: errorMsg });
        }

        const user = await findUserByEmail(email);

        // Security Note: In a production app, you might want to fake a password 
        // comparison here if the user is missing to prevent timing attacks.
        if (!user) {
            return page({ error: errorMsg });
        }

        const valid = await comparePassword(password, user.password_hash);
        if (!valid) {
            return page({ error: errorMsg });
        }

        const sessionId = await createSession(user.id);
        const headers = new Headers();

        setCookie(headers, {
            name: "auth_session",
            value: sessionId,
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
            // maxAge: 60 * 60 * 24 * 7, 
        });

        headers.set("location", "/");

        return new Response(null, {
            status: 303,
            headers,
        });
    },
});

export default define.page<typeof handler>(({ data }) => {
    return (
        <div class="p-4 mx-auto max-w-screen-md">
            <h1 class="text-2xl font-bold mb-4">Login</h1>
            {data?.error && <p class="text-red-500 mb-4">{data.error}</p>}

            <form method="POST" class="flex flex-col gap-4">
                <label>
                    Email
                    <input type="email" name="email" class="border p-2 w-full" required />
                </label>
                <label>
                    Password
                    <input type="password" name="password" class="border p-2 w-full" required />
                </label>
                <button type="submit" class="bg-green-500 text-white p-2 rounded">
                    Log In
                </button>
            </form>
            <p class="mt-4">
                Need an account? <a href="/register" class="underline">Register</a>
            </p>
        </div>
    );
});
