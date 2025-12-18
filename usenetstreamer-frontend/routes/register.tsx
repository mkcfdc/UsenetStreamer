// 1. Import 'page' from "fresh"
import { page } from "fresh";
import { define } from "../utils.ts";
import { createUser } from "../utils/db/users.ts";

interface Data {
    error?: string;
}

export const handler = define.handlers<Data>({
    async POST(ctx) {
        const form = await ctx.req.formData();
        const email = form.get("email")?.toString();
        const password = form.get("password")?.toString();

        if (!email || !password) {
            // 2. ERROR WAS HERE: Change ctx.render(...) to page(...)
            return page({ error: "Email and password are required" });
        }

        try {
            await createUser(email, password);

            const headers = new Headers();
            headers.set("location", "/login");
            return new Response(null, {
                status: 303,
                headers,
            });
        } catch (err) {
            // 3. ERROR WAS HERE: Change ctx.render(...) to page(...)
            const message = err instanceof Error ? err.message : String(err);
            return page({ error: message });
        }
    },
});

export default define.page<typeof handler>(({ data }) => {
    return (
        <div class="p-4 mx-auto max-w-screen-md">
            <h1 class="text-2xl font-bold mb-4">Register</h1>
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
                <button type="submit" class="bg-blue-500 text-white p-2 rounded">
                    Sign Up
                </button>
            </form>
            <p class="mt-4">Already have an account? <a href="/login" class="underline">Login</a></p>
        </div>
    );
});
