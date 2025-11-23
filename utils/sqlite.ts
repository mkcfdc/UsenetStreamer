import { Database } from "@db/sqlite";
import { NZBHYDRA_URL, PROWLARR_URL } from "../env.ts";

const useLocalDb = !PROWLARR_URL && !NZBHYDRA_URL;
let db: Database | null = null;

if (useLocalDb) {
    const dbPath = Deno.env.get("DB_LOCATION") || "nzb_indexers.db";
    db = new Database(dbPath);
    db.exec(`
    CREATE TABLE IF NOT EXISTS indexers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      enabled BOOLEAN DEFAULT 1
    )
  `);
}

export interface Indexer {
    id: number;
    name: string;
    url: string;
    api_key: string;
    enabled: number;
}

export const getEnabledIndexers = (): Indexer[] => {
    if (!db) return [];
    return db.prepare("SELECT * FROM indexers WHERE enabled = 1").all() as Indexer[];
};

export const getAllIndexers = (): Indexer[] => {
    if (!db) return [];
    return db.prepare("SELECT * FROM indexers").all() as Indexer[];
};

export const addIndexer = (name: string, url: string, apiKey: string) => {
    if (!db) return [];
    const cleanUrl = url.replace(/\/$/, "");
    db.prepare("INSERT INTO indexers (name, url, api_key) VALUES (?, ?, ?)").run(name, cleanUrl, apiKey);
};

export const removeIndexer = (id: number) => {
    if (!db) return [];
    db.prepare("DELETE FROM indexers WHERE id = ?").run(id);
};

export const toggleIndexer = (id: number, enabled: boolean) => {
    if (!db) return [];
    db.prepare("UPDATE indexers SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
};