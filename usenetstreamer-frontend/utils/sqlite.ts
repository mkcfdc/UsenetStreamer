import { DatabaseSync } from "node:sqlite";
// deno-lint-ignore no-import-prefix
import { join } from "jsr:@std/path@1.1.3";
import { SCHEMA_SQL, SQLITE_PRAGMAS } from "../../shared/schema.ts";
import { getCachedSetting, setCachedSetting } from "../../shared/settingsCache.ts";

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
    if (dbInstance) return dbInstance;

    const dataDir = Deno.env.get("DATA_DIR") || join(Deno.cwd(), "data");
    const dbFileName = Deno.env.get("DB_FILENAME") || "nzb_indexers.db";
    const dbPath = join(dataDir, dbFileName);

    console.log(`\n%c[Database] %cInitializing sqlite at: ${dbPath}`, "color: blue;", "color: green;");

    try {
        Deno.mkdirSync(dataDir, { recursive: true });
    } catch (e) {
        if (!(e instanceof Deno.errors.AlreadyExists)) {
            console.error(`%c[Database] %cFailed to create data directory: ${dataDir}, Error: ${e.message}`, "color: blue;", "color: red;");
            throw e;
        }
    }

    const db = new DatabaseSync(dbPath);
    db.exec(SQLITE_PRAGMAS);
    db.exec(SCHEMA_SQL);
    dbInstance = db;
    return db;
}

export interface Setting {
    key: string;
    value: string;
    description: string;
}

export const getAllSettings = (): Setting[] => {
    const stmt = getDb().prepare("SELECT key, value, description FROM settings ORDER BY key ASC");
    return stmt.all() as unknown as Setting[];
};

export function getOrSetSetting(key: string, defaultValue: string, description: string = ""): string {
    const envVal = Deno.env.get(key);
    if (envVal !== undefined) return envVal;

    const cached = getCachedSetting(key);
    if (cached !== undefined) return cached;

    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (row) {
        setCachedSetting(key, row.value);
        return row.value;
    }

    try {
        db.prepare("INSERT INTO settings (key, value, description) VALUES (?, ?, ?)").run(key, defaultValue, description);
    } catch (_err) {
        // Ignore race conditions (SQLITE_CONSTRAINT)
    }

    setCachedSetting(key, defaultValue);
    return defaultValue;
}

export function updateSetting(key: string, value: string) {
    const db = getDb();
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
    setCachedSetting(key, value);
}

export interface Indexer {
    id: number;
    name: string;
    url: string;
    api_key: string;
    enabled: number;
}

export const getEnabledIndexers = (): Indexer[] => {
    return getDb().prepare("SELECT * FROM indexers WHERE enabled = 1").all() as unknown as Indexer[];
};

export const getAllIndexers = (): Indexer[] => {
    return getDb().prepare("SELECT * FROM indexers").all() as unknown as Indexer[];
};

export const addIndexer = (name: string, url: string, apiKey: string) => {
    getDb().prepare("INSERT INTO indexers (name, url, api_key) VALUES (?, ?, ?)").run(name, url.replace(/\/$/, ""), apiKey);
};

export const removeIndexer = (id: number) => {
    getDb().prepare("DELETE FROM indexers WHERE id = ?").run(id);
};

export const toggleIndexer = (id: number, enabled: boolean) => {
    getDb().prepare("UPDATE indexers SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
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
    ssl: number;
    connection_count: number;
    priority: number;
    active: number;
}

export const getAllNntpServers = (): NntpServer[] => {
    return getDb().prepare("SELECT * FROM nntp_servers ORDER BY priority ASC, name ASC").all() as unknown as NntpServer[];
};

export const addNntpServer = (server: Omit<NntpServer, "id" | "active" | "created_at" | "updated_at">) => {
    getDb().prepare(`
        INSERT INTO nntp_servers (name, host, port, username, password, ssl, connection_count, priority, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
        server.name,
        server.host,
        server.port,
        server.username || null,
        server.password || null,
        server.ssl,
        server.connection_count,
        server.priority,
    );
};

export const removeNntpServer = (id: number) => {
    getDb().prepare("DELETE FROM nntp_servers WHERE id = ?").run(id);
};

export const toggleNntpServer = (id: number, active: boolean) => {
    getDb().prepare("UPDATE nntp_servers SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
};
