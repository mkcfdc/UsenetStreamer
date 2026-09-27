import { parseRedisUrl } from "./redisUrl.ts";

function encode(cmd: string[]): Uint8Array {
    const parts = [`*${cmd.length}\r\n`];
    for (const arg of cmd) {
        const bytes = new TextEncoder().encode(arg);
        parts.push(`$${bytes.length}\r\n`, arg, `\r\n`);
    }
    return new TextEncoder().encode(parts.join(""));
}

async function readLine(conn: Deno.Conn): Promise<string> {
    const buf = new Uint8Array(1);
    const chars: number[] = [];
    while (true) {
        const n = await conn.read(buf);
        if (n === null) throw new Error("Redis connection closed");
        if (buf[0] === 10) break;
        if (buf[0] !== 13) chars.push(buf[0]);
    }
    return new TextDecoder().decode(new Uint8Array(chars));
}

async function readBulk(conn: Deno.Conn, len: number): Promise<string | null> {
    if (len < 0) return null;
    const data = new Uint8Array(len + 2);
    let offset = 0;
    while (offset < data.length) {
        const n = await conn.read(data.subarray(offset));
        if (n === null) throw new Error("Redis connection closed");
        offset += n;
    }
    return new TextDecoder().decode(data.subarray(0, len));
}

async function readReply(conn: Deno.Conn): Promise<string | null> {
    const line = await readLine(conn);
    if (!line) throw new Error("Empty Redis reply");
    const type = line[0];
    const rest = line.slice(1);
    if (type === "+") return rest;
    if (type === "-") throw new Error(rest);
    if (type === ":") return rest;
    if (type === "$") return await readBulk(conn, Number(rest));
    throw new Error(`Unsupported Redis reply: ${line}`);
}

export interface RawRedis {
    send(...cmd: string[]): Promise<string | null>;
    close(): void;
}

export async function connectRawRedis(url: string, timeoutMs = 5000): Promise<RawRedis> {
    const parsed = parseRedisUrl(url);
    const abort = AbortSignal.timeout(timeoutMs);
    const conn = parsed.tls
        ? await Deno.connectTls({ hostname: parsed.hostname, port: parsed.port })
        : await Deno.connect({ hostname: parsed.hostname, port: parsed.port });

    const send = async (...cmd: string[]) => {
        await conn.write(encode(cmd));
        return await readReply(conn);
    };

    try {
        if (parsed.password) {
            const auth = parsed.username
                ? await send("AUTH", parsed.username, parsed.password)
                : await send("AUTH", parsed.password);
            if (auth !== "OK") throw new Error(`AUTH failed: ${auth}`);
        }
        if (abort.aborted) throw new Error("Connection timed out");
        return {
            send,
            close() {
                try { conn.close(); } catch { /* ignore */ }
            },
        };
    } catch (err) {
        try { conn.close(); } catch { /* ignore */ }
        throw err;
    }
}

export async function pingRedis(url: string, timeoutMs = 5000): Promise<string> {
    const client = await connectRawRedis(url, timeoutMs);
    try {
        const pong = await Promise.race([
            client.send("PING"),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Connection timed out (5s)")), timeoutMs)
            ),
        ]);
        if (pong !== "PONG") throw new Error(`Unexpected response: ${pong}`);
        return "PONG";
    } finally {
        client.close();
    }
}
