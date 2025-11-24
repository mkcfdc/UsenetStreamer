// manage.ts
import { parseArgs } from "@std/cli/parse-args";
import {
    addIndexer,
    closeDb,
    removeIndexer,
    toggleIndexer,
} from "../utils/sqlite.ts";

import { displayList } from "./utils/displayList.ts";
import { log, CSS } from "./utils/log.ts";
import { validateIndexer } from "./utils/fetchWithTimeout.ts";
import { runInteractive } from "./interactive/runInteractive.ts";


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
