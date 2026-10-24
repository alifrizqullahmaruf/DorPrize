import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileJournal } from "./store";

describe("durable local native journal", () => {
  it("snapshots values when queued and rejects structurally invalid state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dorprize-journal-"));
    try {
      const store = await FileJournal.create(directory);
      const value = { status: "pending" };
      const pending = store.put("tx:a", value);
      value.status = "mutated";
      await pending;
      expect(await store.get("tx:a")).toEqual({ status: "pending" });
      await store.close();
      await writeFile(join(directory, "state.json"), "[]");
      await expect(FileJournal.create(directory)).rejects.toThrow("record object");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("serializes writes, protects against a second writer, and survives reopening", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dorprize-journal-"));
    try {
      const store = await FileJournal.create(directory);
      try {
        await expect(FileJournal.create(directory)).rejects.toThrow();
        await Promise.all([
          store.put("match:a", { result: "a", status: "result" }),
          store.put("tx:b", { raw: "0x123", status: "pending" }),
        ]);
        const read = await store.get<{ result: string }>("match:a");
        read!.result = "mutated";
        expect(await store.get("match:a")).toMatchObject({ result: "a" });
      } finally {
        await store.close();
      }
      const reopened = await FileJournal.create(directory);
      try {
        expect(await reopened.list("match:")).toEqual([{ result: "a", status: "result" }]);
        expect(await reopened.get("tx:b")).toMatchObject({ raw: "0x123", status: "pending" });
      } finally {
        await reopened.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("fails closed on corrupt state and releases the startup lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dorprize-journal-"));
    try {
      await writeFile(join(directory, "state.json"), "invalid-json");
      await expect(FileJournal.create(directory)).rejects.toThrow();
      await writeFile(join(directory, "state.json"), "{}");
      const store = await FileJournal.create(directory);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
