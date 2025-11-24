import { log, CSS } from "../utils/log.ts";
import { getPresets } from "../utils/fetchWithTimeout.ts";
import { closeDb } from "../../utils/sqlite.ts";
import { handleAddInteractive } from "./handles/handleAddInteractive.ts";
import { handleRemoveInteractive } from "./handles/handleRemoveInteractive.ts";
import { handleToggleInteractive } from "./handles/handleToggleInteractive.ts";

import { displayList } from "../utils/displayList.ts";

export async function runInteractive() {
    log.mute("Loading presets...");
    const presets = await getPresets();

    while (true) {
        console.clear();
        log.title("👋 Indexer Manager");
        log.mute("---------------------------");

        console.log(`%cPlease select an action:`, CSS.bold);
        console.log(`  %c[L]%c List Indexers`, CSS.highlight, "");
        console.log(`  %c[A]%c Add Indexer`, CSS.highlight, "");
        console.log(`  %c[R]%c Remove Indexer`, CSS.highlight, "");
        console.log(`  %c[E]%c Enable/Disable`, CSS.highlight, "");
        console.log(`  %c[Q]%c Quit`, CSS.error, "");
        console.log("");

        const action = prompt(">")?.toLowerCase();

        switch (action) {
            case "l":
                console.clear();
                log.header("--- Current Indexers ---");
                displayList();
                prompt("\nPress Enter to return...");
                break;
            case "a":
                await handleAddInteractive(presets);
                break;
            case "r":
                handleRemoveInteractive();
                break;
            case "e":
                handleToggleInteractive();
                break;
            case "q":
                console.clear();
                closeDb();
                log.title("Bye! 👋");
                Deno.exit(0);
                break;
            default:
                break;
        }
    }
}