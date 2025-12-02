// routes/api/nntp.ts
import { define } from "../../utils.ts";
import { Context } from "fresh/server";
import { getAllNntpServers, addNntpServer, removeNntpServer, toggleNntpServer } from "../../utils/sqlite.ts";

export const handler = define.handlers<unknown, unknown>({
    // GET /api/nntp
    GET(_ctx: Context<unknown, unknown>) {
        try {
            const servers = getAllNntpServers();
            return new Response(JSON.stringify(servers), {
                headers: { "Content-Type": "application/json" },
            });
        } catch (error) {
            console.error("Error fetching nntp servers:", error);
            return new Response(JSON.stringify({ message: "Failed to fetch servers" }), { status: 500 });
        }
    },

    // POST /api/nntp
    async POST(ctx: Context<unknown, unknown>) {
        try {
            const body = await ctx.req.json();
            const { name, host, port, username, password, ssl, connection_count, priority } = body;

            if (!name || !host || !port) {
                return new Response(JSON.stringify({ message: "Name, Host, and Port are required." }), { status: 400 });
            }

            addNntpServer({
                name,
                host,
                port: parseInt(port),
                username,
                password,
                ssl: ssl ? 1 : 0,
                connection_count: parseInt(connection_count) || 4, // Default to 4 if missing
                priority: parseInt(priority) || 0
            });

            return new Response(JSON.stringify({ message: "Server added successfully." }), { status: 201 });
        } catch (error: any) {
            console.error("Error adding nntp server:", error);
            if (error.message && error.message.includes("UNIQUE constraint failed")) {
                return new Response(JSON.stringify({ message: "A server with this name already exists." }), { status: 409 });
            }
            return new Response(JSON.stringify({ message: error.message || "Failed to add server" }), { status: 500 });
        }
    },

    // DELETE /api/nntp/:id
    DELETE(ctx: Context<unknown, unknown>) {
        try {
            const id = parseInt(ctx.params.id);
            if (isNaN(id)) return new Response(null, { status: 400 });
            removeNntpServer(id);
            return new Response(JSON.stringify({ message: "Server removed." }), { status: 200 });
        } catch (error) {
            console.error(error);
            return new Response(JSON.stringify({ message: "Failed to remove server" }), { status: 500 });
        }
    },

    // PATCH /api/nntp/:id/toggle
    async PATCH(ctx: Context<unknown, unknown>) {
        try {
            const id = parseInt(ctx.params.id);
            const { enabled } = await ctx.req.json();

            if (isNaN(id)) return new Response(null, { status: 400 });

            toggleNntpServer(id, enabled);
            return new Response(JSON.stringify({ message: "Status updated." }), { status: 200 });
        } catch (error) {
            console.error(error);
            return new Response(JSON.stringify({ message: "Failed to update status" }), { status: 500 });
        }
    },
});
