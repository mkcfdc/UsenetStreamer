import { getAllIndexers } from "../../utils/sqlite.ts";
import { log } from "./log.ts";

interface Indexer {
    id: number;
    name: string;
    url: string;
    api_key: string;
    enabled: number;
}

export function displayList(): boolean {
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