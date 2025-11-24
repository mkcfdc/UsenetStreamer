import { log, CSS } from "../../utils/log.ts";
import { validateIndexer, type Preset } from "../../utils/fetchWithTimeout.ts";
import { addIndexer } from "../../../utils/sqlite.ts";

export async function handleAddInteractive(presets: Preset[]) {
    console.clear();
    log.header("--- Add New Indexer ---");

    console.log(`%c[1] Custom (Enter details manually)`, CSS.highlight);
    presets.forEach((p, index) => {
        console.log(`%c[${index + 2}] ${p.name}`, CSS.highlight);
    });

    const selection = prompt("\nSelect an option (default 1):") || "1";
    const choice = parseInt(selection);

    let name = "";
    let url = "";

    if (choice === 1) {
        name = prompt("Name:") || "";
        if (!name) return;
        url = prompt("URL:") || "";
        if (!url) return;
    } else {
        const preset = presets[choice - 2];
        if (preset) {
            name = preset.name;
            url = preset.url;
            log.info(`Selected: ${name}`);
            log.mute(`URL: ${url}`);
        } else {
            log.error("Invalid preset selection.");
            return;
        }
    }

    const key = prompt("API Key:");
    if (!key) {
        log.error("API Key is required.");
        return;
    }

    log.warn(`Testing connection to ${url}...`);
    if (await validateIndexer(url, key)) {
        try {
            addIndexer(name, url, key);
            log.success(`Connected and added indexer: ${name}`);
        } catch (err) {
            log.error(err instanceof Error ? err.message : String(err));
        }
    } else {
        log.error(`Connection Failed! Verify URL and API Key for ${name}.`);
    }

    prompt("\nPress Enter to return...");
}