import { getDb } from "../sqlite.ts";
import { hashPassword } from "../../utils/security.ts";

export interface User {
    id: number;
    email: string;
}

export const createUser = async (email: string, password: string) => {
    const passwordHash = await hashPassword(password);
    const db = getDb();

    try {
        const insertUserStmt = db.prepare(`
            INSERT INTO users (email, password_hash) VALUES (?, ?)
        `);

        // node:sqlite syntax: pass arguments directly to run()
        const result = insertUserStmt.run(email, passwordHash);

        // result.lastInsertRowid is the ID of the new user
        return result.lastInsertRowid;
    } catch (err: any) {
        // node:sqlite errors often look like:
        // [Error: SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email]

        // specific check for Unique Constraint violation
        if (err.message.includes("UNIQUE constraint failed")) {
            throw new Error("Email already exists");
        }

        // Or check code if available (ERR_SQLITE_ERROR is generic in some versions)
        if (err.code === 'ERR_SQLITE_ERROR' && err.message.includes('UNIQUE')) {
            throw new Error("Email already exists");
        }

        throw err;
    }
};

export const findUserByEmail = (email: string) => {
    const db = getDb();

    const getUserByEmailStmt = db.prepare(`
        SELECT id, email, password_hash FROM users WHERE email = ?
    `);

    // Returns { id, email, password_hash } or undefined
    return getUserByEmailStmt.get(email) as
        | { id: number; email: string; password_hash: string }
        | undefined;
};

export const findUserById = (id: number) => {
    const db = getDb();

    const getUserByIdStmt = db.prepare(`
        SELECT id, email FROM users WHERE id = ?
    `);

    return getUserByIdStmt.get(id) as User | undefined;
};
