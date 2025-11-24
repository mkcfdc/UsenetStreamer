import { DatabaseSync } from "node:sqlite";

let dbInstance: DatabaseSync | null = null;

function getDb(): DatabaseSync {
    if (dbInstance) return dbInstance;

    // Default to a 'data' subdirectory for Docker mounting
    const dbPath = Deno.env.get("DB_LOCATION") || "./data/nzb_indexers.db";

    console.log(`\n%c[Database] %cInitializing sqlite at: ${dbPath}`, "color: blue;", "color: green;");

    const db = new DatabaseSync(dbPath);

    // Initialize schema
    db.exec(`
    CREATE TABLE IF NOT EXISTS indexers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      enabled INTEGER DEFAULT 1  
    ) STRICT
  `);

    dbInstance = db;
    return db;
}

// --- Exported Functions ---

export interface Indexer {
    id: number;
    name: string;
    url: string;
    api_key: string;
    enabled: number; // SQLite stores booleans as 0/1
}

export const getEnabledIndexers = (): Indexer[] => {
    const stmt = getDb().prepare("SELECT * FROM indexers WHERE enabled = 1");
    return stmt.all() as unknown as Indexer[];
};

export const getAllIndexers = (): Indexer[] => {
    const stmt = getDb().prepare("SELECT * FROM indexers");
    return stmt.all() as unknown as Indexer[];
};

export const addIndexer = (name: string, url: string, apiKey: string) => {
    const cleanUrl = url.replace(/\/$/, "");
    const stmt = getDb().prepare("INSERT INTO indexers (name, url, api_key) VALUES (?, ?, ?)");
    stmt.run(name, cleanUrl, apiKey);
};

export const removeIndexer = (id: number) => {
    const stmt = getDb().prepare("DELETE FROM indexers WHERE id = ?");
    stmt.run(id);
};

export const toggleIndexer = (id: number, enabled: boolean) => {
    const stmt = getDb().prepare("UPDATE indexers SET enabled = ? WHERE id = ?");
    stmt.run(enabled ? 1 : 0, id);
};