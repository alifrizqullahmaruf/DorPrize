import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Single-writer journal. Results are committed before any settlement is signed. */
export interface Journal {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  list<T>(prefix: string): Promise<T[]>;
  close(): Promise<void>;
}

export class FileJournal implements Journal {
  private records: Record<string, unknown> = {};
  private queue = Promise.resolve();
  private closed = false;
  private constructor(
    private directory: string,
    private unlock: () => Promise<void>,
  ) {}

  static async create(directory: string) {
    await mkdir(directory, { recursive: true });
    // Never run two relayers against the same local journal. A stale lock after a
    // crash is deliberately fail-closed; the operator must verify the old process stopped.
    const lock = await open(join(directory, "writer.lock"), "wx", 0o600);
    await lock.writeFile(String(process.pid));
    const journal = new FileJournal(directory, async () => {
      await lock.close();
      const { unlink } = await import("node:fs/promises");
      await unlink(join(directory, "writer.lock"));
    });
    try {
      journal.records = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
      if (!journal.records || typeof journal.records !== "object" || Array.isArray(journal.records))
        throw new Error("Journal state must be a record object");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await journal.close();
        throw error;
      }
    }
    return journal;
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (this.closed) throw new Error("Journal is closed");
    await this.queue;
    return structuredClone(this.records[key]) as T | undefined;
  }

  put(key: string, value: unknown) {
    if (this.closed) return Promise.reject(new Error("Journal is closed"));
    const snapshot = structuredClone(value);
    const next = this.queue.then(async () => {
      const records = { ...this.records, [key]: snapshot };
      const tmp = join(this.directory, `${randomUUID()}.tmp`);
      const file = await open(tmp, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(records));
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await rename(tmp, join(this.directory, "state.json"));
      } catch (error) {
        await unlink(tmp).catch(() => {});
        throw error;
      }
      this.records = records;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  async list<T>(prefix: string): Promise<T[]> {
    if (this.closed) throw new Error("Journal is closed");
    await this.queue;
    return structuredClone(
      Object.entries(this.records)
        .filter(([key]) => key.startsWith(prefix))
        .map(([, v]) => v),
    ) as T[];
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.queue;
    await this.unlock();
  }
}

/** Production journal for Supabase/PostgreSQL. Holds one advisory lock per deployment. */
export async function postgresJournal(connectionString: string): Promise<Journal> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
  let healthy = true;
  client.on("error", () => {
    healthy = false;
  });
  client.on("end", () => {
    healthy = false;
  });
  try {
    await client.connect();
    // Use a direct/session connection, never a transaction-pooling URL.
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(10143, 712) AS locked");
    if (!lock.rows[0]?.locked) throw new Error("Native backend writer already running");
    await client.query("BEGIN");
    await client.query(await readFile(new URL("../../migrations/001_native_journal.sql", import.meta.url), "utf8"));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
    throw error;
  }
  const check = () => {
    if (!healthy) throw new Error("PostgreSQL writer lock lost; restart backend");
  };
  return {
    async get<T>(key: string) {
      check();
      const result = await client.query("SELECT value FROM dorprize_native_records WHERE key=$1", [key]);
      return result.rows[0]?.value as T | undefined;
    },
    async put(key: string, value: unknown) {
      check();
      await client.query(
        "INSERT INTO dorprize_native_records (key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
        [key, JSON.stringify(value)],
      );
    },
    async list<T>(prefix: string) {
      check();
      const result = await client.query(
        "SELECT value FROM dorprize_native_records WHERE left(key,length($1))=$1 ORDER BY key",
        [prefix],
      );
      return result.rows.map((row) => row.value as T);
    },
    async close() {
      healthy = false;
      await client.end();
    },
  };
}
