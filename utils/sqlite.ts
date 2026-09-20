import { DatabaseSync } from "node:sqlite";
import { join } from "@std/path";
import { SCHEMA_SQL, SQLITE_PRAGMAS } from "../shared/schema.ts";
import { getCachedSetting, setCachedSetting } from "../shared/settingsCache.ts";

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
    if (envVal !== undefined) {
        return envVal;
    }

    const cached = getCachedSetting(key);
    if (cached !== undefined) return cached;

    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;

    if (row) {
        setCachedSetting(key, row.value);
        return row.value;
    }

    try {
        const stmt = db.prepare("INSERT INTO settings (key, value, description) VALUES (?, ?, ?)");
        stmt.run(key, defaultValue, description);
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
    ssl: number;
    connection_count: number;
    priority: number;
    active: number;
}

export const getAllNntpServers = (): NntpServer[] => {
    const stmt = getDb().prepare("SELECT * FROM nntp_servers ORDER BY priority ASC, name ASC");
    return stmt.all() as unknown as NntpServer[];
};

export const addNntpServer = (server: Omit<NntpServer, "id" | "active" | "created_at" | "updated_at">) => {
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

export function getActiveNntpServerUrls(): string[] {
    const db = getDb();
    const serverUrls: string[] = [];

    try {
        const stmt = db.prepare(`
            SELECT host, port, username, password, ssl, connection_count
            FROM nntp_servers
            WHERE active = 1
            ORDER BY priority ASC, id ASC
        `);

        const rows = stmt.all() as any[];

        for (const row of rows) {
            const { host, port, username, password, ssl, connection_count } = row;
            const protocol = ssl === 1 ? "nntps" : "nntp";
            let authPart = "";
            if (username && password) {
                authPart = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
            } else if (username) {
                authPart = `${encodeURIComponent(username)}@`;
            }
            const connections = connection_count > 0 ? connection_count : 1;
            serverUrls.push(`${protocol}://${authPart}${host}:${port}/${connections}`);
        }
    } catch (error) {
        console.error("Failed to fetch NNTP server configurations:", error);
        return [];
    }

    return serverUrls;
}
