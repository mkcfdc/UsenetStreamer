import { define } from "../../../../utils.ts"; // Adjust path if necessary
import { Context } from "fresh/server";
import { toggleIndexer } from "../../../../utils/sqlite.ts";

export const handler = define.handlers<unknown, unknown>({
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
