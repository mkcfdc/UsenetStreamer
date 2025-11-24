// routes/api/indexers.ts
import { define } from "../../utils.ts"; // Adjust path if necessary
import { Context } from "fresh/server";
import { getAllIndexers, addIndexer, removeIndexer, toggleIndexer } from "../../utils/sqlite.ts";

export const handler = define.handlers<unknown, unknown>({
    // GET /api/indexers - Fetch all indexers
    GET(_ctx: Context<unknown, unknown>) {
        try {
            const indexers = getAllIndexers();
            return new Response(JSON.stringify(indexers), {
                headers: { "Content-Type": "application/json" },
            });
        } catch (error) {
            console.error("Error fetching indexers:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            return new Response(JSON.stringify({ message: errorMessage || "Failed to fetch indexers" }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }
    },

    // POST /api/indexers - Add a new indexer
    async POST(ctx: Context<unknown, unknown>) {
        try {
            const { name, url, api_key } = await ctx.req.json();
            if (!name || !url || !api_key) {
                return new Response(JSON.stringify({ message: "Name, URL, and API Key are required." }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }

            addIndexer(name, url, api_key);
            return new Response(JSON.stringify({ message: "Indexer added successfully." }), {
                status: 201,
                headers: { "Content-Type": "application/json" },
            });
        } catch (error) {
            console.error("Error adding indexer:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            return new Response(JSON.stringify({ message: errorMessage || "Failed to add indexer" }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }
    },

    // DELETE /api/indexers/:id - Remove an indexer
    DELETE(ctx: Context<unknown, unknown>) {
        try {
            const idParam = ctx.params.id; // Access ID from route parameters
            const id = parseInt(idParam);

            if (isNaN(id)) {
                return new Response(JSON.stringify({ message: "Invalid indexer ID." }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }

            removeIndexer(id);
            return new Response(JSON.stringify({ message: "Indexer removed successfully." }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        } catch (error) {
            console.error("Error removing indexer:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            return new Response(JSON.stringify({ message: errorMessage || "Failed to remove indexer" }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }
    },

    // PATCH /api/indexers/:id/toggle - Toggle indexer enabled status
    async PATCH(ctx: Context<unknown, unknown>) {
        try {
            const idParam = ctx.params.id;
            const id = parseInt(idParam);

            if (isNaN(id)) {
                return new Response(JSON.stringify({ message: "Invalid indexer ID." }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }

            const { enabled } = await ctx.req.json(); // Expect { enabled: boolean } in body

            if (typeof enabled !== 'boolean') {
                return new Response(JSON.stringify({ message: "Invalid 'enabled' status. Must be boolean." }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }

            toggleIndexer(id, enabled);
            return new Response(JSON.stringify({ message: "Indexer status toggled successfully." }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        } catch (error) {
            console.error("Error toggling indexer status:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            return new Response(JSON.stringify({ message: errorMessage || "Failed to toggle indexer status" }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }
    },
});
