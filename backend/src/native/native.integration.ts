import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import {
  createPublicClient,
  createWalletClient,
  createTestClient,
  http,
  parseEther,
  encodeFunctionData,
  keccak256,
  toHex,
  type Account,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { nativeGameVaultAbi } from "@dorprize/contracts/native";
import { io as connect, type Socket } from "socket.io-client";
import { createNativeServer } from "./app";
import { loadConfig } from "../config";
import { FileJournal } from "./store";
import type { NativeConfig } from "./config";
import type { MatchRecord } from "./service";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await delay(50);
  }
  throw new Error("Timed out waiting for integration condition");
}
function event<T>(socket: Socket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, done);
      reject(new Error(`Timed out waiting for ${name}`));
    }, 10_000);
    const done = (value: T) => {
      clearTimeout(timer);
      resolve(value);
    };
    socket.once(name, done);
  });
}
const ack = (socket: Socket, name: string, payload: unknown) =>
  socket.timeout(10_000).emitWithAck(name, payload) as Promise<{ ok: boolean; error?: string }>;

test(
  "native backend: real wallet auth, escrow validation, game, durable settlement and restart recovery",
  { timeout: 90_000 },
  async (t) => {
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = (listener.address() as { port: number }).port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    const child = spawn(
      process.env.ANVIL_BIN || "anvil",
      [
        "--network",
        "monad",
        "--chain-id",
        "31337",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--block-time",
        "0.1",
        "--slots-in-an-epoch",
        "1",
        "--silent",
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    let startupError: Error | undefined;
    let cleanup = async () => {};
    child.on("error", (error) => {
      startupError = error;
    });
    t.after(async () => {
      try {
        await cleanup();
      } finally {
        if (child.exitCode === null && !startupError) {
          child.kill();
          await once(child, "exit");
        }
      }
    });
    const rpcUrl = `http://127.0.0.1:${port}`;
    const transport = http(rpcUrl, { retryCount: 0, timeout: 1000 });
    const client = createPublicClient({ chain: foundry, transport, pollingInterval: 20 });
    await until(async () => {
      if (startupError) throw startupError;
      return client.getChainId().catch(() => undefined);
    });
    // Public Anvil development mnemonic, used only on the ephemeral localhost chain.
    const accounts = [0, 1, 2, 3, 4].map((addressIndex) =>
      mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex }),
    );
    const [operator, alice, bob, treasury, outsider] = accounts;
    const wallet = createWalletClient({ account: operator, chain: foundry, transport });
    const testClient = createTestClient({ mode: "anvil", chain: foundry, transport });
    const artifactPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../sc/out/NativeGameVault.sol/NativeGameVault.json",
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const deployed = await client.waitForTransactionReceipt({
      hash: await wallet.deployContract({
        abi: nativeGameVaultAbi,
        bytecode: artifact.bytecode.object as Hex,
        args: [operator.address, operator.address, operator.address, treasury.address],
      }),
    });
    const vault = deployed.contractAddress!;
    await until(async () => (await client.getCode({ address: vault, blockTag: "finalized" })) !== undefined);
    const write = async (account: Account, functionName: string, args: readonly unknown[] = [], value?: bigint) => {
      const { request } = await client.simulateContract({
        address: vault,
        abi: nativeGameVaultAbi as import("viem").Abi,
        functionName,
        args,
        account,
        value,
      });
      const gas = await client.estimateContractGas({
        address: vault,
        abi: nativeGameVaultAbi as import("viem").Abi,
        functionName,
        args,
        account,
        value,
      });
      const receipt = await client.waitForTransactionReceipt({
        hash: await wallet.writeContract({ ...request, gas, account }),
      });
      assert.equal(receipt.status, "success");
      await until(async () => (await client.getBlock({ blockTag: "finalized" })).number >= receipt.blockNumber);
    };
    const directory = await mkdtemp(join(tmpdir(), "dorprize-native-e2e-"));
    cleanup = () => rm(directory, { recursive: true, force: true });
    const config = { ...loadConfig({}), timeScale: 0.2 };
    const native: NativeConfig = {
      chainId: 31337,
      rpcUrl,
      vault,
      operatorKey: toKey(operator),
      signerKey: toKey(operator),
      authOrigin: "https://dorprize.vercel.app",
      stateDirectory: directory,
      workerIntervalMs: 100,
    };
    let store = await FileJournal.create(directory);
    let server = await createNativeServer(config, native, store);
    let base = `http://127.0.0.1:${await server.listen(0)}`;
    const sockets: Socket[] = [];
    cleanup = async () => {
      sockets.forEach((socket) => socket.disconnect());
      await server.close();
      await rm(directory, { recursive: true, force: true });
    };
    const request = async (path: string, token?: string, body?: unknown) => {
      const res = await fetch(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
    const login = async (account: typeof alice) => {
      const challenge = (await request("/auth/challenge", undefined, { address: account.address })).body;
      return (
        await request("/auth/verify", undefined, {
          challengeId: challenge.challengeId,
          signature: await account.signMessage({ message: challenge.message }),
        })
      ).body.token as string;
    };
    const aliceToken = await login(alice),
      bobToken = await login(bob),
      outsiderToken = await login(outsider);
    const socket = async (token: string) => {
      const s = connect(base, {
        auth: { token, playerId: outsider.address },
        transports: ["websocket"],
        forceNew: true,
      });
      sockets.push(s);
      await event(s, "connect");
      return s;
    };
    const a = await socket(aliceToken),
      b = await socket(bobToken),
      o = await socket(outsiderToken);
    let room: Record<string, any>;
    await t.test("requires signed wallet sessions and rejects spoofed guest identities/origins", async () => {
      assert.equal((await request("/ready")).status, 200);
      const originalGet = store.get;
      store.get = async () => {
        throw new Error("private database connection unavailable");
      };
      try {
        const unavailable = await request("/ready");
        assert.equal(unavailable.status, 503);
        assert.equal(unavailable.body.error, "Native persistence or RPC unavailable");
      } finally {
        store.get = originalGet;
      }
      assert.equal(
        (await request("/rooms", undefined, { bidWei: parseEther("1").toString(), maxPlayers: 2 })).status,
        401,
      );
      const rejected = connect(base, { auth: { playerId: alice.address }, transports: ["websocket"], forceNew: true });
      sockets.push(rejected);
      const error = await event<Error>(rejected, "connect_error");
      assert.equal(error.message, "Wallet session required");
      rejected.disconnect();
      const origin = await fetch(`${base}/config`, { headers: { origin: "https://evil.invalid" } });
      assert.equal(origin.status, 403);
    });
    await t.test("finalizes a reverted pending transaction without blocking other operator jobs", async () => {
      const data = encodeFunctionData({
        abi: nativeGameVaultAbi,
        functionName: "createRoom",
        args: [keccak256(toHex("invalid-capacity")), parseEther("1"), 1, (await server.chain.timestamp()) + 600n],
      });
      const prepared = await wallet.prepareTransactionRequest({ to: vault, data, gas: 250_000n });
      const raw = await wallet.signTransaction(prepared);
      const id = "integration:revert";
      const hash = keccak256(raw);
      await store.put(`tx:${id}`, { id, raw, hash, status: "pending" });
      await server.chain.initialize();
      assert.equal((await store.get<{ status: string }>(`tx:${id}`))?.status, "reverted");
      await assert.rejects(server.chain.write(id, "createRoom", []), /reverted/);
      assert.equal((await request("/ready")).status, 200);
    });
    await t.test("creates native room and requires confirmed escrow membership", async () => {
      const made = await request("/rooms", aliceToken, {
        name: "Native E2E",
        bidWei: parseEther("1").toString(),
        maxPlayers: 2,
      });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      room = made.body;
      assert.equal((await ack(a, "room:join", { roomId: room.roomId, name: "Alice", skin: "soldier" })).ok, false);
      for (const [account, token, budget] of [
        [alice, aliceToken, "0.4"],
        [bob, bobToken, "0"],
      ] as const) {
        await write(account, "deposit", [], parseEther("5"));
        const issued = await request(`/rooms/${room.roomId}/ticket`, token, {
          skillBudgetWei: parseEther(budget).toString(),
        });
        assert.equal(issued.status, 200, JSON.stringify(issued.body));
        const ticket = issued.body.ticket;
        assert.equal(ticket.player, account.address);
        await write(account, "joinRoom", [
          {
            ...ticket,
            skillBudgetWei: BigInt(ticket.skillBudgetWei),
            nonce: BigInt(ticket.nonce),
            deadline: BigInt(ticket.deadline),
          },
          issued.body.signature,
        ]);
      }
      assert.equal((await ack(a, "room:join", { roomId: room.roomId, name: "Alice", skin: "soldier" })).ok, true);
      assert.equal((await ack(b, "room:join", { roomId: room.roomId, name: "Bob", skin: "soldier" })).ok, true);
      assert.equal((await ack(o, "room:join", { roomId: room.roomId, name: "Outsider", skin: "soldier" })).ok, false);
      assert.equal((await ack(a, "room:leave", { roomId: room.roomId })).ok, false);
    });
    await t.test(
      "confirms frozen roster before gameplay and rejects overspending, stale rounds and duplicate changes",
      async () => {
        const first = event<{ round: number; me: { x: number; y: number }; myMines: unknown[] }>(a, "round:start");
        await ack(a, "room:ready", { ready: true });
        await ack(b, "room:ready", { ready: true });
        const start = await first;
        const onchain = await server.chain.room(room.escrowRoomId);
        assert.equal(onchain.status, 2);
        assert.equal(onchain.players.length, 2);
        assert.deepEqual(Object.keys(start).includes("players"), false);
        const action = { moveTo: { x: 3, y: 3 }, shootDir: "E", skill: "goldHelm", mineAt: null };
        assert.equal(
          (
            await ack(b, "round:submit", {
              round: 1,
              seq: 1,
              actionId: "bob-mine-1",
              action: { ...action, skill: "mine" },
            })
          ).ok,
          false,
        );
        assert.equal((await ack(a, "round:submit", { round: 0, seq: 1, actionId: "alice-old-1", action })).ok, false);
        const envelope = { round: start.round, seq: 1, actionId: "alice-round-1", action };
        assert.equal((await ack(a, "round:submit", envelope)).ok, true);
        assert.equal((await ack(a, "round:submit", envelope)).ok, true);
        assert.equal((await ack(a, "round:submit", { ...envelope, action: { ...action, skill: null } })).ok, false);
        assert.equal(
          (
            await ack(b, "round:submit", {
              round: start.round,
              seq: 2,
              actionId: "bob-round-1",
              action: { ...action, shootDir: "W", skill: null },
            })
          ).ok,
          true,
        );
        await event(a, "game:end");
      },
    );
    await t.test("persists server result, charges exact native skill fees and settles once", async () => {
      const result = await until(async () => {
        const status = await request(`/matches/${room.roomId}/result`, aliceToken);
        return status.body.status === "settled" ? status.body : undefined;
      });
      assert.equal(result.result.potWei, parseEther("2").toString());
      assert.deepEqual(result.result.recipients, [alice.address]);
      assert.deepEqual(result.result.skillFeesWei, [parseEther("0.4").toString(), "0"]);
      const durable = await store.get<MatchRecord>(`match:${room.roomId}`);
      assert.equal(durable?.result?.resultHash, result.result.resultHash);
      assert.equal(durable?.audit?.length, 1);
      assert.equal(durable?.audit?.[0].round, 1);
      const confirmed = await server.chain.room(room.escrowRoomId);
      assert.equal(confirmed.resultHash, result.result.resultHash);
      const balance = await request("/balance", aliceToken);
      assert.equal(balance.body.availableWei, parseEther("5.6").toString());
      assert.equal(balance.body.bidLockedWei, "0");
      assert.equal(balance.body.skillReservedWei, "0");
      assert.equal(await server.chain.read<bigint>("totalTreasuryClaimable"), parseEther("0.4"));
      assert.equal((await request("/api/game/submit-settlement", outsiderToken, { roomId: room.roomId })).status, 400);
      assert.equal(
        (await request("/api/game/submit-settlement", aliceToken, { roomId: room.roomId, winners: [outsider.address] }))
          .status,
        400,
      );
      const retry = await request("/api/game/submit-settlement", aliceToken, { roomId: room.roomId });
      assert.equal(retry.body.txHash, result.txHash);
      assert.equal((await request("/balance", aliceToken)).body.availableWei, balance.body.availableWei);
      await write(alice, "withdraw", [parseEther("5.6")]);
      assert.equal((await request("/balance", aliceToken)).body.availableWei, "0");
    });
    await t.test("restart keeps results and cancels/refunds waiting escrow", async () => {
      const made = await request("/rooms", bobToken, { bidWei: parseEther("1").toString(), maxPlayers: 2 });
      assert.equal(made.status, 201);
      const waiting = made.body;
      const issued = await request(`/rooms/${waiting.roomId}/ticket`, bobToken, { skillBudgetWei: "0" });
      const ticket = issued.body.ticket;
      await write(bob, "joinRoom", [
        { ...ticket, skillBudgetWei: 0n, nonce: BigInt(ticket.nonce), deadline: BigInt(ticket.deadline) },
        issued.body.signature,
      ]);
      sockets.forEach((s) => s.disconnect());
      await server.close();
      store = await FileJournal.create(directory);
      // Reproduce a crash after the signed settlement was mined but before the
      // server recorded its terminal status. Recovery must reuse its hash/nonce.
      const persisted = (await store.get<MatchRecord>(`match:${room.roomId}`))!;
      const expectedHash = persisted.settlementTx;
      persisted.status = "result";
      delete persisted.settlementTx;
      await store.put(`match:${room.roomId}`, persisted);
      const tx = (await store.get<import("./chain").ChainJob>(`tx:settle:${persisted.matchId}`))!;
      await store.put(`tx:settle:${persisted.matchId}`, { ...tx, status: "pending" });
      server = await createNativeServer(config, native, store);
      base = `http://127.0.0.1:${await server.listen(0)}`;
      const token = await login(bob);
      assert.equal((await server.chain.room(waiting.escrowRoomId)).status, 4);
      assert.equal((await request("/balance", token)).body.availableWei, parseEther("4").toString());
      const recovered = (await request(`/matches/${room.roomId}/result`, token)).body;
      assert.equal(recovered.status, "settled");
      assert.equal(recovered.txHash, expectedHash);
      assert.equal(await server.chain.read<bigint>("availableBalanceOf", [alice.address]), 0n);
      assert.equal((await request("/auth/session", bobToken)).status, 401);
    });
    await t.test("lost active match remains locked until expiry, then refunds every bid and budget", async () => {
      const bt = await login(bob),
        ot = await login(outsider);
      const bs = await socket(bt),
        os = await socket(ot);
      await write(outsider, "deposit", [], parseEther("5"));
      const made = await request("/rooms", bt, { bidWei: parseEther("1").toString(), maxPlayers: 2 });
      const active = made.body;
      assert.equal(made.status, 201);
      for (const [account, token, s] of [
        [bob, bt, bs],
        [outsider, ot, os],
      ] as const) {
        const issued = await request(`/rooms/${active.roomId}/ticket`, token, {
          skillBudgetWei: parseEther("1").toString(),
        });
        const ticket = issued.body.ticket;
        await write(account, "joinRoom", [
          {
            ...ticket,
            skillBudgetWei: BigInt(ticket.skillBudgetWei),
            nonce: BigInt(ticket.nonce),
            deadline: BigInt(ticket.deadline),
          },
          issued.body.signature,
        ]);
        assert.equal(
          (await ack(s, "room:join", { roomId: active.roomId, name: "Recovery", skin: "soldier" })).ok,
          true,
        );
      }
      const started = event(bs, "round:start");
      await ack(bs, "room:ready", { ready: true });
      await ack(os, "room:ready", { ready: true });
      await started;
      sockets.forEach((s) => s.disconnect());
      await server.close();
      store = await FileJournal.create(directory);
      server = await createNativeServer(config, native, store);
      base = `http://127.0.0.1:${await server.listen(0)}`;
      assert.equal((await server.chain.room(active.escrowRoomId)).status, 2);
      assert.equal(server.service.rooms.has(active.roomId), false);
      assert.equal(await server.chain.read<bigint>("lockedBalanceOf", [bob.address]), parseEther("1"));
      await testClient.increaseTime({ seconds: 901 });
      await testClient.mine({ blocks: 5 });
      await until(async () => (await server.chain.room(active.escrowRoomId)).status === 4);
      assert.equal(await server.chain.read<bigint>("availableBalanceOf", [bob.address]), parseEther("4"));
      assert.equal(await server.chain.read<bigint>("availableBalanceOf", [outsider.address]), parseEther("5"));
      assert.equal(await server.chain.read<bigint>("skillReservedOf", [bob.address]), 0n);
      assert.equal(await server.chain.read<bigint>("skillReservedOf", [outsider.address]), 0n);
    });
  },
);

function toKey(account: ReturnType<typeof mnemonicToAccount>): Hex {
  const key = account.getHdKey().privateKey;
  assert.ok(key);
  return `0x${Buffer.from(key).toString("hex")}`;
}
