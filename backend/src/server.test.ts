import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import type { RoomState, RoundResolve, RoundStart, ServerEvents } from "@dorprize/game-core";
import { createGameServer, type GameServer } from "./app";
import { loadConfig } from "./config";

// 50x faster phases so a whole round takes well under a second.
const config = { ...loadConfig({}), timeScale: 0.02, sweepIntervalMs: 60_000 };
let server: GameServer;
let base = "";
const sockets: Socket[] = [];

beforeAll(async () => {
  server = createGameServer(config);
  const port = await server.listen(0);
  base = `http://localhost:${port}`;
});

afterEach(() => {
  sockets.splice(0).forEach((s) => s.disconnect());
});

afterAll(async () => {
  await server.close();
});

function client(playerId: string, name = playerId) {
  const s = connect(base, { auth: { playerId, name }, transports: ["websocket"], forceNew: true });
  sockets.push(s);
  return s;
}

function next<E extends keyof ServerEvents>(
  s: Socket,
  event: E,
  match: (p: ServerEvents[E]) => boolean = () => true,
  ms = 4000,
): Promise<ServerEvents[E]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    const handler = (p: ServerEvents[E]) => {
      if (!match(p)) return;
      clearTimeout(timer);
      s.off(event, handler as never);
      resolve(p);
    };
    s.on(event, handler as never);
  });
}

async function createRoom(body: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Arena", bid: 1, maxPlayers: 4, isPrivate: false, ...body }),
  });
  return { status: res.status, body: (await res.json()) as { roomId?: string; error?: string } };
}

const connected = (s: Socket) =>
  new Promise<void>((resolve) => (s.connected ? resolve() : s.once("connect", () => resolve())));

/** Two players join a fresh room and ready up; resolves at the first round:start. */
async function twoPlayerGame() {
  const { body } = await createRoom();
  const roomId = body.roomId!;
  const alice = client("alice-0001", "Alice");
  const bob = client("bob-000001", "Bob");
  const aliceIn = next(alice, "room:state", (s) => s.meNum !== null);
  alice.emit("room:join", { roomId, name: "Alice", skin: "soldier" });
  await aliceIn;
  const bobIn = next(bob, "room:state", (s) => s.players.length === 2 && s.meNum !== null);
  bob.emit("room:join", { roomId, name: "Bob", skin: "navy" });
  await bobIn;
  const startA = next(alice, "round:start");
  const startB = next(bob, "round:start");
  alice.emit("room:ready", { ready: true });
  bob.emit("room:ready", { ready: true });
  const [a, b] = await Promise.all([startA, startB]);
  return { roomId, alice, bob, a, b };
}

describe("REST", () => {
  it("reports health", async () => {
    const res = await fetch(`${base}/health`);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("creates rooms, lists public ones and validates input", async () => {
    const pub = await createRoom({ name: "Publik" });
    const priv = await createRoom({ name: "Rahasia", isPrivate: true });
    expect(pub.status).toBe(201);
    const list = (await (await fetch(`${base}/rooms`)).json()) as { roomId: string }[];
    expect(list.map((r) => r.roomId)).toContain(pub.body.roomId);
    expect(list.map((r) => r.roomId)).not.toContain(priv.body.roomId);

    expect((await createRoom({ bid: 0.5 })).status).toBe(400);
    expect((await createRoom({ maxPlayers: 11 })).status).toBe(400);
  });
});

describe("Socket.io game flow", () => {
  it("rejects connections without a valid player id", async () => {
    const s = connect(base, { auth: { playerId: "x" }, transports: ["websocket"], forceNew: true });
    sockets.push(s);
    const err = await new Promise<Error>((resolve) => s.once("connect_error", resolve));
    expect(err.message).toBe("invalid playerId");
  });

  it("reports unknown rooms", async () => {
    const s = client("lonely-0001");
    const err = next(s, "room:error");
    s.emit("room:join", { roomId: "NOPE42", name: "X", skin: "soldier" });
    expect((await err).message).toBe("Room tidak ditemukan.");
  });

  it("plays a round between two real clients without leaking positions", async () => {
    const { alice, bob, a, b } = await twoPlayerGame();
    // Each player is told only their own position.
    expect(a.round).toBe(1);
    expect(a.me).not.toEqual(b.me);

    // Both lock in -> resolve reveals everybody to everybody.
    const resA = next(alice, "round:resolve");
    const resB = next(bob, "round:resolve");
    alice.emit("round:submit", { moveTo: null, shootDir: null, skill: null, mineAt: null });
    bob.emit("round:submit", { moveTo: null, shootDir: null, skill: null, mineAt: null });
    const [ra, rb]: RoundResolve[] = await Promise.all([resA, resB]);
    expect(ra.revealed).toHaveLength(2);
    expect(ra.me).toMatchObject({ x: a.me.x, y: a.me.y, alive: true });
    expect(rb.me).toMatchObject({ x: b.me.x, y: b.me.y, alive: true });
  });

  it("never puts coordinates in room:state", async () => {
    const { alice } = await twoPlayerGame();
    const state: RoomState = await next(alice, "room:state");
    expect(JSON.stringify(state)).not.toMatch(/"x"|"y"/);
  });

  it("ignores malformed submits instead of crashing", async () => {
    const { alice, bob } = await twoPlayerGame();
    alice.emit("round:submit", { moveTo: { x: "1", y: 2 }, shootDir: "UP", skill: "nuke" });
    alice.emit("round:submit", "garbage");
    // The round still resolves on the timer and the server keeps serving.
    const res = await next(bob, "round:resolve", () => true, 4000);
    expect(res.round).toBe(1);
    expect((await fetch(`${base}/health`)).ok).toBe(true);
  });

  it("resyncs a player who reconnects in the middle of a round", async () => {
    const { roomId, bob } = await twoPlayerGame();
    bob.disconnect();
    const again = client("bob-000001", "Bob");
    const start: Promise<RoundStart> = next(again, "round:start");
    again.emit("room:join", { roomId, name: "Bob", skin: "navy" });
    const s = await start;
    expect(s.round).toBe(1);
    expect(s.me.alive).toBe(true);
  });

  it("does not let a third player join a running game", async () => {
    const { roomId } = await twoPlayerGame();
    const carol = client("carol-0001", "Carol");
    const err = next(carol, "room:error");
    carol.emit("room:join", { roomId, name: "Carol", skin: "urban" });
    expect((await err).message).toBe("Game di room ini sudah dimulai.");
  });

  it("keeps the current seat when joining a room that already started", async () => {
    const { roomId: running } = await twoPlayerGame();
    const { body } = await createRoom();
    const carol = client("carol-0002", "Carol");
    const inLobby = next(carol, "room:state", (s) => s.meNum !== null);
    carol.emit("room:join", { roomId: body.roomId, name: "Carol", skin: "urban" });
    await inLobby;
    const err = next(carol, "room:error");
    carol.emit("room:join", { roomId: running, name: "Carol", skin: "urban" });
    expect((await err).message).toBe("Game di room ini sudah dimulai.");
    expect(server.registry.get(body.roomId!)!.seatOf("carol-0002")).toBeDefined();
  });

  it("frees a lobby seat when its tab closes, even if another tab of the player is open", async () => {
    const { body } = await createRoom();
    const tabA = client("dave-00001", "Dave");
    const tabB = client("dave-00001", "Dave");
    await Promise.all([connected(tabA), connected(tabB)]);
    const joined = next(tabA, "room:state", (s) => s.meNum !== null);
    tabA.emit("room:join", { roomId: body.roomId, name: "Dave", skin: "urban" });
    await joined;
    tabA.disconnect();
    await new Promise((r) => setTimeout(r, 150));
    expect(tabB.connected).toBe(true);
    expect(server.registry.get(body.roomId!)!.seatOf("dave-00001")).toBeUndefined();
  });

  it("keeps a running game when its only human drops, and resyncs on return", async () => {
    const { roomId, alice, bob } = await twoPlayerGame();
    bob.emit("room:leave", { roomId }); // Bob walks out: forfeits
    await new Promise((r) => setTimeout(r, 50));
    alice.disconnect(); // Alice only drops
    await new Promise((r) => setTimeout(r, 50));
    expect(server.registry.get(roomId)).toBeDefined();
    const again = client("alice-0001", "Alice");
    const state = next(again, "room:state", (s) => s.meNum !== null);
    again.emit("room:join", { roomId, name: "Alice", skin: "soldier" });
    expect((await state).roomId).toBe(roomId);
  });
});
