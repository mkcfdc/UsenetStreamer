// deno-lint-ignore-file no-explicit-any
// manage.ts
import { parseArgs } from "@std/cli/parse-args";
import { addIndexer, getAllIndexers, removeIndexer, toggleIndexer } from "./utils/sqlite.ts";

const PRESETS_URL = "https://raw.githubusercontent.com/mkcfdc/UsenetStreamer/refs/heads/master/indexer_presets.json";

const DEFAULT_PRESETS = [
    { name: "NZBGeek", url: "https://api.nzbgeek.info" },
    { name: "DrunkenSlug", url: "https://api.drunkenslug.com" },
    { name: "NZBPlanet", url: "https://api.nzbplanet.net" },
    { name: "SimplyNZBs", url: "https://simplynzbs.com" },
];

const STYLE = {
    title: "color: #5ed3f3; font-weight: bold; font-size: 1.2em;",
    header: "color: #ecc94b; font-weight: bold;",
    success: "color: #48bb78; font-weight: bold;",
    error: "color: #f56565; font-weight: bold;",
    mute: "color: #718096;",
    highlight: "color: #63b3ed;",
    warn: "color: #ed8936; font-weight: bold;",
};

const args = parseArgs(Deno.args, {
    boolean: ["help"],
    string: ["name", "url", "key", "id"],
    alias: { n: "name", u: "url", k: "key", i: "id", h: "help" },
});

const command = args._[0];

async function getPresets() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(PRESETS_URL, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                return data;
            }
        }
    } catch {
        // Fallback to defaults if fetch fails (offline, 404, etc)
    }
    return DEFAULT_PRESETS;
}

async function validateIndexer(url: string, key: string): Promise<boolean> {
    try {
        const baseUrl = url.replace(/\/$/, "");
        const testUrl = `${baseUrl}/api?t=caps&apikey=${key}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(testUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) return false;

        const text = await response.text();

        if (text.includes("<error")) return false;
        if (text.includes("<caps") || text.includes("<rss")) return true;

        return false;
    } catch {
        return false;
    }
}

function displayList() {
    const list = getAllIndexers();
    if (list.length === 0) {
        console.log("%cNo indexers found.", STYLE.mute);
        return false;
    }
    console.table(
        list.map((i) => ({
            ID: i.id,
            Name: i.name,
            URL: i.url,
            Enabled: i.enabled === 1 ? "✅" : "❌",
            Key: `${i.api_key.substring(0, 4)}...`,
        }))
    );
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
  `, STYLE.header, "", STYLE.header, "");
}

async function runInteractive() {
    let statusMessage = "";
    let statusType: "success" | "error" | "info" = "info";

    console.log("%cLoading presets...", STYLE.mute);
    const presets = await getPresets();

    while (true) {
        console.clear();
        console.log("%c👋 Indexer Manager", STYLE.title);
        console.log("%c---------------------------", STYLE.mute);

        if (statusMessage) {
            const style = statusType === 'error' ? STYLE.error :
                statusType === 'success' ? STYLE.success : STYLE.highlight;

            console.log(`%c${statusMessage}`, style);
            console.log("%c---------------------------", STYLE.mute);

            statusMessage = "";
        }

        // Print Menu
        console.log(`%cPlease select an action:`, "font-weight: bold");
        console.log(`  %c[L]%c List Indexers`, STYLE.highlight, "");
        console.log(`  %c[A]%c Add Indexer`, STYLE.highlight, "");
        console.log(`  %c[R]%c Remove Indexer`, STYLE.highlight, "");
        console.log(`  %c[E]%c Enable/Disable`, STYLE.highlight, "");
        console.log(`  %c[Q]%c Quit`, STYLE.error, "");
        console.log("");

        const action = prompt(">");

        if (!action) continue;

        switch (action.toLowerCase()) {
            case "l":
                console.clear();
                console.log("%c--- Current Indexers ---", STYLE.header);
                displayList();
                prompt("\nPress Enter to return to menu...");
                break;

            case "a": {
                console.clear();
                console.log("%c--- Add New Indexer ---", STYLE.header);

                console.log(`%c[1] Custom (Enter details manually)`, STYLE.highlight);
                presets.forEach((p, index) => {
                    console.log(`%c[${index + 2}] ${p.name}`, STYLE.highlight);
                });

                const selection = prompt("\nSelect an option (default 1):");
                const choice = selection ? parseInt(selection) : 1;

                let name, url;

                if (choice === 1) {
                    name = prompt("Name:");
                    if (!name) break;
                    url = prompt("URL:");
                    if (!url) break;
                } else {
                    const preset = presets[choice - 2];
                    if (preset) {
                        name = preset.name;
                        url = preset.url;
                        console.log(`\n%cSelected: ${name}`, STYLE.highlight);
                        console.log(`%cURL: ${url}`, STYLE.mute);
                    } else {
                        statusMessage = "❌ Invalid preset selection.";
                        statusType = "error";
                        break;
                    }
                }

                const key = prompt("API Key:");
                if (!key) {
                    statusMessage = "❌ API Key is required. Action aborted.";
                    statusType = "error";
                    break;
                }

                console.log(`\n%cTesting connection to ${url}...`, STYLE.warn);

                const isValid = await validateIndexer(url, key);

                if (!isValid) {
                    statusMessage = `❌ Connection Failed! Verify URL and API Key for ${name}.`;
                    statusType = "error";
                    break;
                }

                try {
                    addIndexer(name, url, key);
                    statusMessage = `✅ Success! Connected and added indexer: ${name}`;
                    statusType = "success";
                } catch (err: any) {
                    statusMessage = `❌ Failed to add: ${err.message}`;
                    statusType = "error";
                }
                break;
            }

            case "r": {
                console.clear();
                console.log("%c--- Remove Indexer ---", STYLE.header);
                if (!displayList()) {
                    prompt("\nPress Enter to return...");
                    break;
                }

                const id = prompt("\nEnter ID to remove (or enter to cancel):");
                if (!id) break;

                if (confirm(`Are you sure you want to delete ID ${id}?`)) {
                    try {
                        removeIndexer(Number(id));
                        statusMessage = `🗑️  Indexer ID ${id} removed.`;
                        statusType = "success";
                    } catch (err: any) {
                        statusMessage = `❌ Error: ${err.message}`;
                        statusType = "error";
                    }
                }
                break;
            }

            case "e": {
                console.clear();
                console.log("%c--- Enable / Disable Indexer ---", STYLE.header);
                if (!displayList()) {
                    prompt("\nPress Enter to return...");
                    break;
                }

                const id = prompt("\nEnter ID to toggle (or enter to cancel):");
                if (!id) break;

                const shouldEnable = confirm("Enable this indexer? (Y=Enable, N=Disable)");
                try {
                    toggleIndexer(Number(id), shouldEnable);
                    statusMessage = `✅ Indexer ID ${id} is now ${shouldEnable ? 'Enabled' : 'Disabled'}.`;
                    statusType = "success";
                } catch (err: any) {
                    statusMessage = `❌ Error: ${err.message}`;
                    statusType = "error";
                }
                break;
            }

            case "q":
                console.clear();
                console.log("%cBye! 👋", STYLE.title);
                Deno.exit(0);
                break;

            default:
                statusMessage = "⚠️ Invalid selection. Please try again.";
                statusType = "error";
        }
    }
}

if (args.help) {
    printUsage();
    Deno.exit(0);
}

if (!command) {
    await runInteractive();
}

switch (command) {
    case "list":
        displayList();
        break;

    case "add": {
        if (!args.name || !args.url || !args.key) {
            console.error("%c❌ Error: Missing required flags. Need --name, --url, and --key", STYLE.error);
            Deno.exit(1);
        }

        console.log(`%cTesting connection to ${args.url}...`, STYLE.warn);
        const isValid = await validateIndexer(args.url, args.key);

        if (!isValid) {
            console.error(`%c❌ Connection Failed! Could not validate ${args.name}. Check URL and API Key.`, STYLE.error);
            Deno.exit(1);
        }

        try {
            addIndexer(args.name, args.url, args.key);
            console.log(`%c✅ Added indexer: ${args.name}`, STYLE.success);
        } catch (err: any) {
            console.error(`%c❌ Failed to add: ${err.message}`, STYLE.error);
        }
        break;
    }

    case "remove": {
        const id = args._[1] || args.id;
        if (!id) {
            console.error("%c❌ Error: Missing ID. Usage: remove <id>", STYLE.error);
            Deno.exit(1);
        }
        removeIndexer(Number(id));
        console.log(`%c🗑️  Indexer ID ${id} removed.`, STYLE.success);
        break;
    }

    case "disable": {
        const id = args._[1];
        if (!id) { console.error("%cMissing ID", STYLE.error); Deno.exit(1); }
        toggleIndexer(Number(id), false);
        console.log(`%cIndex ID ${id} disabled.`, STYLE.success);
        break;
    }

    case "enable": {
        const id = args._[1];
        if (!id) { console.error("%cMissing ID", STYLE.error); Deno.exit(1); }
        toggleIndexer(Number(id), true);
        console.log(`%cIndex ID ${id} enabled.`, STYLE.success);
        break;
    }

    default:
        console.error(`%cUnknown command: ${command}`, STYLE.error);
        printUsage();
}