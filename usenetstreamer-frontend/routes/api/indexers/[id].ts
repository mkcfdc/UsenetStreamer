// routes/api/indexers/[id].ts
import { define } from "../../../utils.ts"; // Adjust path if necessary
import { Context } from "fresh/server";
import { removeIndexer } from "../../../utils/sqlite.ts";

export const handler = define.handlers<unknown, unknown>({
    // DELETE /api/indexers/:id - Remove an indexer
    DELETE(ctx: Context<unknown, unknown>) {
        try {
            const idParam = ctx.params.id;
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
});
