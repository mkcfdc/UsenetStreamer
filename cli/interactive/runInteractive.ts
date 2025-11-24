import { log, CSS } from "../utils/log.ts";
import { getPresets } from "../utils/fetchWithTimeout.ts";
import { closeDb, getAllSettings, updateSetting } from "../../utils/sqlite.ts";
import { validateConfig } from "../../env.ts";

import { handleAddInteractive } from "./handles/handleAddInteractive.ts";
import { handleRemoveInteractive } from "./handles/handleRemoveInteractive.ts";
import { handleToggleInteractive } from "./handles/handleToggleInteractive.ts";
import { displayList } from "../utils/displayList.ts";

export async function runInitInteractive() {
    console.clear();
    log.title("🪄  Setup Wizard");
    log.mute("---------------------------");

    const missing = validateConfig();

    if (missing.length === 0) {
        log.success("✅ System Configuration is valid.");
        const force = confirm("Do you want to review/edit all settings anyway?");
        if (!force) return;
        await manageConfig();
        return;
    }

    log.warn(`Found ${missing.length} missing configuration(s).`);

    for (const key of missing) {
        let value = "";
        while (!value) {
            console.log(`\n%cPlease enter value for: %c${key}`, CSS.bold, CSS.highlight);
            value = prompt("> ") || "";
            if (!value.trim()) log.error("Value cannot be empty.");
        }
        updateSetting(key, value.trim());
        log.success("Saved.");
    }

    console.log("");
    log.success("🎉 Setup Complete!");
    console.log("%cNote: You may need to restart the container.", CSS.mute);
    prompt("Press Enter to continue...");
}

export async function runInteractive() {
    while (true) {
        console.clear();
        log.title("🎛️  System Dashboard");

        // Status Bar
        const missing = validateConfig();
        if (missing.length > 0) {
            console.log(`%c[!] System Status: %c${missing.length} Issues`, CSS.bold, CSS.error);
        } else {
            console.log(`%c[✓] System Status: %cOperational`, CSS.bold, "color: green");
        }
        log.mute("---------------------------");

        console.log(`  %c[1]%c Setup Wizard (Fix Issues)`, CSS.highlight, "");
        console.log(`  %c[2]%c Configuration Editor`, CSS.highlight, "");
        console.log(`  %c[3]%c Indexer Manager`, CSS.highlight, "");
        console.log(`  %c[Q]%c Quit`, CSS.error, "");
        console.log("");

        const action = prompt(">")?.toLowerCase();

        switch (action) {
            case "1":
                await runInitInteractive();
                break;
            case "2":
                await manageConfig();
                break;
            case "3":
                await manageIndexers(); // Your original logic
                break;
            case "q":
                console.clear();
                closeDb();
                log.title("Bye! 👋");
                Deno.exit(0);
                break;
        }
    }
}

async function manageConfig() {
    while (true) {
        console.clear();
        log.title("⚙️  Configuration Editor");
        log.mute("---------------------------");

        const settings = getAllSettings();

        // Custom Table View
        if (settings.length === 0) console.log("No settings found.");
        else {
            console.table(settings.map(s => ({
                Key: s.key,
                Value: s.value.length > 40 ? s.value.substring(0, 37) + "..." : s.value
            })));
        }

        console.log(`\n%cType a %cKey Name%c to edit, %c'add'%c to create, or %c'back'%c to return.`,
            CSS.bold, CSS.highlight, CSS.bold, CSS.highlight, CSS.bold, CSS.highlight, CSS.bold);

        const input = prompt(">")?.trim();
        if (!input || input.toLowerCase() === 'back') break;

        if (input.toLowerCase() === 'add') {
            const k = prompt("New Key Name:");
            if (k) {
                const v = prompt("Value:");
                if (v) {
                    updateSetting(k.toUpperCase(), v);
                    log.success("Created.");
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            continue;
        }

        const item = settings.find(s => s.key === input);
        if (item) {
            console.log(`\n%cCurrent Value:%c ${item.value}`, CSS.bold, "");
            console.log(`%cDescription:%c ${item.description || "N/A"}`, CSS.bold, "");

            const newVal = prompt("New Value (Enter to cancel):");
            if (newVal) {
                updateSetting(item.key, newVal);
                log.success("Updated.");
                await new Promise(r => setTimeout(r, 800));
            }
        } else {
            log.error("Key not found.");
            await new Promise(r => setTimeout(r, 800));
        }
    }
}

async function manageIndexers() {
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
        console.log(`  %c[B]%c Back to Main Menu`, CSS.highlight, ""); // Changed Q to B
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
            case "b": // Changed case Q to B
            case "q":
                return; // Return to Main Dashboard instead of Exit
            default:
                break;
        }
    }
}
