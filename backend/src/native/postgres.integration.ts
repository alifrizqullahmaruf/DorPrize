import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { Client } from "pg";
import { postgresJournal, type Journal } from "./store";

test(
  "real PostgreSQL journal: persistence, writer fencing, private-table access and disconnect recovery",
  { timeout: 90_000 },
  async (t) => {
    // Dedicated ephemeral cluster only; never reads DATABASE_URL or production credentials.
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const directory = await mkdtemp(join(tmpdir(), "dorprize-pg-test-"));
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = (listener.address() as { port: number }).port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    const password = randomBytes(24).toString("hex");
    const logs: string[] = [];
    const database = new EmbeddedPostgres({
      databaseDir: join(directory, "cluster"),
      port,
      user: "postgres",
      password,
      persistent: true,
      createPostgresUser: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      postgresFlags: ["-h", "127.0.0.1"],
      onLog: (value) => logs.push(String(value)),
      onError: (value) => logs.push(String(value)),
    });
    let started = false;
    let store!: Journal;
    let admin!: Client;
    t.after(async () => {
      await store?.close();
      await admin?.end();
      if (started) await database.stop();
      await rm(directory, { recursive: true, force: true });
    });
    try {
      await database.initialise();
      await database.start();
      started = true;
    } catch (error) {
      throw new Error(`Ephemeral PostgreSQL failed to start: ${String(error)} ${logs.slice(-5).join(" ")}`);
    }
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
    admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN");
    store = await postgresJournal(url);

    await t.test("commits and reopens exact integer amounts, pending jobs and private audit", async () => {
      const match = { status: "result", amountWei: "1000000000000000001", audit: [{ position: { x: 3, y: 2 } }] };
      await Promise.all([store.put("match:one", match), store.put("tx:one", { status: "pending", raw: "0x1234" })]);
      await store.close();
      store = await postgresJournal(url);
      assert.deepEqual(await store.get("match:one"), match);
      assert.equal((await store.list("match:")).length, 1);
      assert.deepEqual(await store.get("tx:one"), { status: "pending", raw: "0x1234" });
    });
    await t.test("refuses a second writer, enables RLS and denies browser roles", async () => {
      await assert.rejects(postgresJournal(url), /writer already running/);
      const settings = await admin.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid='dorprize_native_records'::regclass",
      );
      assert.equal(settings.rows[0].relrowsecurity, true);
      for (const role of ["anon", "authenticated"]) {
        const access = await admin.query(
          "SELECT has_table_privilege($1,'dorprize_native_records','SELECT') AS allowed",
          [role],
        );
        assert.equal(access.rows[0].allowed, false);
      }
      // Even accidental later SELECT grants cannot expose rows through RLS.
      await admin.query("GRANT SELECT ON dorprize_native_records TO anon; SET ROLE anon");
      assert.equal((await admin.query("SELECT * FROM dorprize_native_records")).rowCount, 0);
      await admin.query("RESET ROLE");
    });
    await t.test("fails closed after losing the lock connection, then allows recovery", async () => {
      const terminated = await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype='advisory' AND classid=10143 AND objid=712 AND pid<>pg_backend_pid()",
      );
      assert.equal(terminated.rowCount, 1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await assert.rejects(store.put("match:bad", { status: "settled" }), /lock lost/);
      await store.close();
      store = await postgresJournal(url);
      assert.equal(await store.get("match:bad"), undefined);
      assert.deepEqual(await store.get("tx:one"), { status: "pending", raw: "0x1234" });
    });
  },
);
