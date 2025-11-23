// manage.ts
import { parseArgs } from "@std/cli/parse-args";
import { addIndexer, getAllIndexers, removeIndexer, toggleIndexer } from "./utils/sqlite.ts";

const args = parseArgs(Deno.args, {
    boolean: ["help"],
    string: ["name", "url", "key", "id"],
    alias: { n: "name", u: "url", k: "key", i: "id", h: "help" },
});

const command = args._[0];

function printUsage() {
    console.log(`
  Usage:
    deno task manage <command> [options]

  Commands:
    list                Show all configured indexers
    add                 Add a new indexer
      --name, -n        Name of the indexer
      --url, -u         Base URL (e.g. https://api.nzbgeek.info)
      --key, -k         API Key
    remove <id>         Remove an indexer by ID
    enable <id>         Enable an indexer
    disable <id>        Disable an indexer
  `);
}

if (args.help || !command) {
    printUsage();
    Deno.exit(0);
}

switch (command) {
    case "list": {
        const list = getAllIndexers();
        if (list.length === 0) {
            console.log("No indexers found.");
        } else {
            console.table(
                list.map((i) => ({
                    ID: i.id,
                    Name: i.name,
                    URL: i.url,
                    Enabled: i.enabled === 1 ? "✅" : "❌",
                    // Mask key for display
                    Key: `${i.api_key.substring(0, 4)}...`,
                }))
            );
        }
        break;
    }

    case "add": {
        if (!args.name || !args.url || !args.key) {
            console.error("❌ Error: Missing required flags. Need --name, --url, and --key");
            Deno.exit(1);
        }
        try {
            addIndexer(args.name, args.url, args.key);
            console.log(`✅ Added indexer: ${args.name}`);
        } catch (err: any) {
            console.error("❌ Failed to add:", err.message);
        }
        break;
    }

    case "remove": {
        const id = args._[1] || args.id;
        if (!id) {
            console.error("❌ Error: Missing ID. Usage: remove <id>");
            Deno.exit(1);
        }
        removeIndexer(Number(id));
        console.log(`🗑️  Indexer ID ${id} removed.`);
        break;
    }

    case "disable": {
        const id = args._[1];
        if (!id) { console.error("Missing ID"); Deno.exit(1); }
        toggleIndexer(Number(id), false);
        console.log(`Index ID ${id} disabled.`);
        break;
    }

    case "enable": {
        const id = args._[1];
        if (!id) { console.error("Missing ID"); Deno.exit(1); }
        toggleIndexer(Number(id), true);
        console.log(`Index ID ${id} enabled.`);
        break;
    }

    default:
        console.error(`Unknown command: ${command}`);
        printUsage();
}
