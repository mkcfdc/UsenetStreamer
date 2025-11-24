import { toggleIndexer } from "../../../utils/sqlite.ts";
import { log } from "../../utils/log.ts";
import { displayList } from "../../utils/displayList.ts";

export function handleToggleInteractive() {
    console.clear();
    log.header("--- Enable / Disable Indexer ---");
    if (!displayList()) {
        prompt("\nPress Enter to return...");
        return;
    }

    const idStr = prompt("\nEnter ID to toggle (or empty to cancel):");
    if (!idStr) return;

    const shouldEnable = confirm("Enable this indexer? (y=Enable, n=Disable)");
    try {
        toggleIndexer(Number(idStr), shouldEnable);
        log.success(
            `Indexer ID ${idStr} is now ${shouldEnable ? "Enabled" : "Disabled"}.`,
        );
    } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
    }
}