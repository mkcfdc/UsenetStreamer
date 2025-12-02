import { DatabaseSync } from "node:sqlite";
// deno-lint-ignore no-import-prefix
import { join } from "jsr:@std/path@1.1.3";

let dbInstance: DatabaseSync | null = null;

function getDb(): DatabaseSync {
    if (dbInstance) return dbInstance;

    const dataDir = Deno.env.get("DATA_DIR") || join(Deno.cwd(), "data");

    const dbFileName = Deno.env.get("DB_FILENAME") || "nzb_indexers.db";
    const dbPath = join(dataDir, dbFileName);

    console.log(`\n%c[Database] %cInitializing sqlite at: ${dbPath}`, "color: blue;", "color: green;");

    try {
        Deno.mkdirSync(dataDir, { recursive: true });
        console.log(`%c[Database] %cEnsured data directory exists: ${dataDir}`, "color: blue;", "color: yellow;");
    } catch (e) {
        if (e instanceof Deno.errors.AlreadyExists) {
            // Directory already exists, which is fine
        } else {
            console.error(`%c[Database] %cFailed to create data directory: ${dataDir}, Error: ${e.message}`, "color: blue;", "color: red;");
            throw e;
        }
    }

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

    db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      description TEXT
    ) STRICT;
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS nntp_servers (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL UNIQUE,
        host        TEXT NOT NULL,
        port        INTEGER NOT NULL,
        username    TEXT,
        password    TEXT,
        ssl         INTEGER NOT NULL DEFAULT 1, 
        connection_count   INTEGER NOT NULL DEFAULT 4, 
        priority    INTEGER NOT NULL DEFAULT 0,
        active      INTEGER NOT NULL DEFAULT 5, 
        created_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%S', 'now')),
        updated_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%S', 'now'))
    ) STRICT;
`);

    dbInstance = db;
    return db;
}

// --- Exported Functions ---

export interface Setting {
    key: string;
    value: string;
    description: string;
}

export const getAllSettings = (): Setting[] => {
    const stmt = getDb().prepare("SELECT key, value, description FROM settings ORDER BY key ASC");
    return stmt.all() as unknown as Setting[];
};

/**
 * Retrieves a configuration value following this priority:
 * 1. System Environment Variable (Overrides everything)
 * 2. Database Value
 * 3. Default Value (Persisted to DB if not present)
 */
export function getOrSetSetting(key: string, defaultValue: string, description: string = ""): string {
    // 1. Check System Environment Variable (Highest Priority)
    // We check this first so you can override DB settings via Docker/CLI without wiping the DB
    const envVal = Deno.env.get(key);
    if (envVal !== undefined) {
        return envVal;
    }

    const db = getDb();

    // 2. Check Database
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;

    if (row) {
        return row.value;
    }

    // 3. Fallback to Default & Persist to DB
    // We insert the default so it becomes editable in the DB for next time
    try {
        const stmt = db.prepare("INSERT INTO settings (key, value, description) VALUES (?, ?, ?)");
        stmt.run(key, defaultValue, description);
    } catch (err) {
        // Ignore race conditions (SQLITE_CONSTRAINT)
    }

    return defaultValue;
}

/**
 * Updates a setting in the database.
 * This allows you to build an API endpoint later to update config via UI.
 */
export function updateSetting(key: string, value: string) {
    const db = getDb();
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

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

export const closeDb = () => {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
};


export interface NntpServer {
    id: number;
    name: string;
    host: string;
    port: number;
    username?: string;
    password?: string;
    ssl: number; // 0 or 1
    connection_count: number;
    priority: number;
    active: number; // 0 or 1 (Using 1 for active)
}

export const getAllNntpServers = (): NntpServer[] => {
    const stmt = getDb().prepare("SELECT * FROM nntp_servers ORDER BY priority ASC, name ASC"); // Changed to ASC priority (usually 0 is highest in Usenet/SABnzbd logic, or DESC if you prefer)
    return stmt.all() as unknown as NntpServer[];
};

export const addNntpServer = (server: Omit<NntpServer, 'id' | 'active' | 'created_at' | 'updated_at'>) => {
    const stmt = getDb().prepare(`
        INSERT INTO nntp_servers (name, host, port, username, password, ssl, connection_count, priority, active) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    stmt.run(
        server.name,
        server.host,
        server.port,
        server.username || null,
        server.password || null,
        server.ssl,
        server.connection_count,
        server.priority
    );
};

export const removeNntpServer = (id: number) => {
    const stmt = getDb().prepare("DELETE FROM nntp_servers WHERE id = ?");
    stmt.run(id);
};

export const toggleNntpServer = (id: number, active: boolean) => {
    const stmt = getDb().prepare("UPDATE nntp_servers SET active = ? WHERE id = ?");
    stmt.run(active ? 1 : 0, id);
};