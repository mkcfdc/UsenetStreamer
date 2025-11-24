import { removeIndexer } from "../../../utils/sqlite.ts";
import { log } from "../../utils/log.ts";
import { displayList } from "../../utils/displayList.ts";

export function handleRemoveInteractive() {
    console.clear();
    log.header("--- Remove Indexer ---");
    if (!displayList()) {
        prompt("\nPress Enter to return...");
        return;
    }

    const idStr = prompt("\nEnter ID to remove (or empty to cancel):");
    if (!idStr) return;

    if (confirm(`Are you sure you want to delete ID ${idStr}?`)) {
        try {
            removeIndexer(Number(idStr));
            log.success(`Indexer ID ${idStr} removed.`);
        } catch (err) {
            log.error(err instanceof Error ? err.message : String(err));
        }
    }
}