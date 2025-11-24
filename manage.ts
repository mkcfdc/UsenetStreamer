// manage.ts
import { parseArgs } from "@std/cli/parse-args";
import {
    addIndexer,
    closeDb,
    getAllIndexers,
    removeIndexer,
    toggleIndexer,
} from "./utils/sqlite.ts";

interface Indexer {
    id: number;
    name: string;
    url: string;
    api_key: string;
    enabled: number;
}

interface Preset {
    name: string;
    url: string;
}

const PRESETS_URL =
    "https://raw.githubusercontent.com/mkcfdc/UsenetStreamer/refs/heads/master/indexer_presets.json";

const DEFAULT_PRESETS: Preset[] = [
    { name: "NZBGeek", url: "https://api.nzbgeek.info" },
    { name: "DrunkenSlug", url: "https://api.drunkenslug.com" },
    { name: "NZBPlanet", url: "https://api.nzbplanet.net" },
    { name: "SimplyNZBs", url: "https://simplynzbs.com" },
];

const CSS = {
    title: "color: #5ed3f3; font-weight: bold; font-size: 1.2em;",
    header: "color: #ecc94b; font-weight: bold;",
    success: "color: #48bb78; font-weight: bold;",
    error: "color: #f56565; font-weight: bold;",
    mute: "color: #718096;",
    highlight: "color: #63b3ed;",
    warn: "color: #ed8936; font-weight: bold;",
    bold: "font-weight: bold;",
};

const log = {
    title: (msg: string) => console.log(`%c${msg}`, CSS.title),
    header: (msg: string) => console.log(`%c${msg}`, CSS.header),
    success: (msg: string) => console.log(`%c${msg}`, CSS.success),
    error: (msg: string) => console.error(`%c${msg}`, CSS.error),
    warn: (msg: string) => console.log(`%c${msg}`, CSS.warn),
    info: (msg: string) => console.log(`%c${msg}`, CSS.highlight),
    mute: (msg: string) => console.log(`%c${msg}`, CSS.mute),
};

async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeout = 5000,
): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(id);
    }
}

async function getPresets(): Promise<Preset[]> {
    try {
        const response = await fetchWithTimeout(PRESETS_URL, {}, 3000);
        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                return data as Preset[];
            }
        }
    } catch {
        // Fallback silently
    }
    return DEFAULT_PRESETS;
}

async function validateIndexer(url: string, key: string): Promise<boolean> {
    try {
        const baseUrl = url.replace(/\/$/, "");
        const testUrl = `${baseUrl}/api?t=caps&apikey=${key}`;

        const response = await fetchWithTimeout(testUrl);
        if (!response.ok) return false;

        const text = await response.text();
        if (text.includes("<error")) return false;
        return text.includes("<caps") || text.includes("<rss");
    } catch {
        return false;
    }
}

function displayList(): boolean {
    const list = getAllIndexers() as Indexer[];
    if (list.length === 0) {
        log.mute("No indexers found.");
        return false;
    }

    const tableData = list.map((i) => ({
        ID: i.id,
        Name: i.name,
        URL: i.url,
        Enabled: i.enabled === 1 ? "✅" : "❌",
        Key: `${i.api_key.substring(0, 4)}...`,
    }));

    console.table(tableData);
    return true;
}

function printUsage() {
    console.log(`
  %cUsage:%c
    deno task manage <command> [options]

  %cCommands:%c
    list                Show all configured indexers
    add                 Add a new indexer
      --name, -n        Name of the indexer
      --url, -u         Base URL
      --key, -k         API Key
    remove <id>         Remove an indexer by ID
    enable <id>         Enable an indexer
    disable <id>        Disable an indexer
  `, CSS.header, "", CSS.header, "");
}

async function handleAddInteractive(presets: Preset[]) {
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

function handleRemoveInteractive() {
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

function handleToggleInteractive() {
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

async function runInteractive() {
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

const args = parseArgs(Deno.args, {
    boolean: ["help"],
    string: ["name", "url", "key", "id"],
    alias: { n: "name", u: "url", k: "key", i: "id", h: "help" },
});

if (args.help) {
    printUsage();
    Deno.exit(0);
}

const command = args._[0];

if (!command) {
    await runInteractive();
} else {
    try {
        switch (command) {
            case "list":
                displayList();
                break;

            case "add": {
                if (!args.name || !args.url || !args.key) {
                    log.error("Missing required flags. Need --name, --url, and --key");
                    Deno.exit(1);
                }

                log.warn(`Testing connection to ${args.url}...`);
                if (await validateIndexer(args.url, args.key)) {
                    addIndexer(args.name, args.url, args.key);
                    log.success(`Added indexer: ${args.name}`);
                } else {
                    log.error(`Connection Failed! Could not validate ${args.name}.`);
                    Deno.exit(1);
                }
                break;
            }

            case "remove": {
                const id = args._[1] || args.id;
                if (!id) {
                    log.error("Missing ID. Usage: remove <id>");
                    Deno.exit(1);
                }
                removeIndexer(Number(id));
                log.success(`Indexer ID ${id} removed.`);
                break;
            }

            case "enable":
            case "disable": {
                const id = args._[1] || args.id;
                if (!id) {
                    log.error("Missing ID");
                    Deno.exit(1);
                }
                const enable = command === "enable";
                toggleIndexer(Number(id), enable);
                log.success(`Index ID ${id} ${enable ? "enabled" : "disabled"}.`);
                break;
            }

            default:
                log.error(`Unknown command: ${command}`);
                printUsage();
                Deno.exit(1);
        }
    } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        closeDb();
        Deno.exit(1);
    } finally {
        closeDb();
    }
}
