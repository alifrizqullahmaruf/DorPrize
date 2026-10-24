import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvents } from "./protocol";
import { RoomRunner, type RoomRunnerOptions } from "./room";
import { SUBMIT_GRACE_MS, TIMING } from "./rules";

type Msg = { to: string; event: keyof ServerEvents; payload: unknown };

function setup(opts: Partial<RoomRunnerOptions> = {}) {
  const inbox: Msg[] = [];
  const room = new RoomRunner({
    roomId: "ROOM1",
    name: "Test",
    bid: 1,
    maxPlayers: 4,
    isPrivate: false,
    rng: () => 0.37,
    send: (to, event, payload) => inbox.push({ to, event, payload }),
    ...opts,
  });
  const last = <E extends keyof ServerEvents>(to: string, event: E) =>
    [...inbox].reverse().find((m) => m.to === to && m.event === event)?.payload as ServerEvents[E] | undefined;
  const count = (to: string, event: keyof ServerEvents) => inbox.filter((m) => m.to === to && m.event === event).length;
  return { room, inbox, last, count };
}

/** Lobby -> countdown -> first input phase with two humans. */
function startTwoPlayerGame(t: ReturnType<typeof setup>) {
  t.room.join("alice", "Alice", "soldier");
  t.room.join("bob", "Bob", "navy");
  t.room.setReady("alice", true);
  t.room.setReady("bob", true);
  expect(t.room.status).toBe("COUNTDOWN");
  vi.advanceTimersByTime(TIMING.countdownMs);
  expect(t.room.status).toBe("ROUND_INPUT");
}

const idle = { moveTo: null, shootDir: null, skill: null, mineAt: null };

describe("RoomRunner", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits for escrow start and freezes lobby mutations while confirmation is pending", async () => {
    let confirm!: () => void;
    const t = setup({
      beforeStart: () =>
        new Promise<void>((resolve) => {
          confirm = resolve;
        }),
      preserveLobbyOnDisconnect: true,
    });
    t.room.join("alice", "Alice", "soldier");
    t.room.join("bob", "Bob", "soldier");
    t.room.setReady("alice", true);
    t.room.setReady("bob", true);
    vi.advanceTimersByTime(TIMING.countdownMs);
    expect(t.room.startPending).toBe(true);
    expect(t.room.engine).toBeNull();
    t.room.leave("alice");
    t.room.setReady("bob", false);
    expect(t.room.humans).toHaveLength(2);
    expect(t.room.seatOf("bob")?.ready).toBe(true);
    expect(t.room.join("carol", "Carol", "soldier").ok).toBe(false);
    confirm();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.room.status).toBe("ROUND_INPUT");
  });

  it("returns to an unready lobby if escrow start fails", async () => {
    const onError = vi.fn();
    const t = setup({
      beforeStart: async () => {
        throw new Error("roster mismatch");
      },
      onError,
    });
    t.room.join("alice", "Alice", "soldier");
    t.room.join("bob", "Bob", "soldier");
    t.room.setReady("alice", true);
    t.room.setReady("bob", true);
    await vi.advanceTimersByTimeAsync(TIMING.countdownMs);
    expect(t.room.status).toBe("LOBBY");
    expect(t.room.engine).toBeNull();
    expect(t.room.humans.every((p) => !p.ready)).toBe(true);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("keeps escrow lobby seats on disconnect and rejects native submits at the deadline", () => {
    const t = setup({ preserveLobbyOnDisconnect: true, strictDeadline: true });
    t.room.join("alice", "Alice", "soldier");
    t.room.disconnect("alice");
    expect(t.room.seatOf("alice")?.connected).toBe(false);
    startTwoPlayerGame(t);
    vi.setSystemTime(t.room.deadline!);
    expect(t.room.submit("alice", idle)).toBe(false);
  });

  it("publishes the game result only after the persistence hook completes", async () => {
    let persist!: () => void;
    const t = setup({
      beforeFinish: () =>
        new Promise<void>((resolve) => {
          persist = resolve;
        }),
    });
    startTwoPlayerGame(t);
    t.room.submit("alice", { ...idle, moveTo: { x: 3, y: 3 }, shootDir: "E" });
    t.room.submit("bob", { ...idle, moveTo: { x: 3, y: 3 }, shootDir: "W" });
    vi.advanceTimersByTime(800 + TIMING.animationMs + TIMING.resultMs);
    expect(t.room.status).toBe("RESULT");
    expect(t.count("alice", "game:end")).toBe(0);
    persist();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.room.status).toBe("FINISHED");
    expect(t.count("alice", "game:end")).toBe(1);
  });

  it("gives every player their own seat number in room:state", () => {
    const t = setup();
    t.room.join("alice", "Alice", "soldier");
    t.room.join("bob", "Bob", "navy");
    expect(t.last("alice", "room:state")?.meNum).toBe(1);
    expect(t.last("bob", "room:state")?.meNum).toBe(2);
    expect(t.last("bob", "room:state")?.players.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("starts the countdown only when every seated player is ready", () => {
    const t = setup();
    t.room.join("alice", "Alice", "soldier");
    t.room.join("bob", "Bob", "navy");
    t.room.setReady("alice", true);
    expect(t.room.status).toBe("LOBBY");
    t.room.setReady("bob", true);
    expect(t.room.status).toBe("COUNTDOWN");
    // Backing out cancels it.
    t.room.setReady("bob", false);
    expect(t.room.status).toBe("LOBBY");
    vi.advanceTimersByTime(TIMING.countdownMs * 2);
    expect(t.room.status).toBe("LOBBY");
  });

  it("never sends one player's position to another during the input phase", () => {
    const t = setup();
    startTwoPlayerGame(t);
    const a = t.last("alice", "round:start")!;
    const b = t.last("bob", "round:start")!;
    const posA = t.room.engine!.players.find((p) => p.num === 1)!;
    const posB = t.room.engine!.players.find((p) => p.num === 2)!;
    expect(a.me).toMatchObject({ x: posA.x, y: posA.y });
    expect(b.me).toMatchObject({ x: posB.x, y: posB.y });
    // room:state carries no coordinates at all.
    const state = JSON.stringify(t.last("alice", "room:state"));
    expect(state).not.toMatch(/"x"|"y"/);
  });

  it("resolves early once everyone locked in and reveals everyone in round:resolve", () => {
    const t = setup();
    startTwoPlayerGame(t);
    t.room.submit("alice", idle);
    t.room.submit("bob", idle);
    vi.advanceTimersByTime(800);
    expect(t.room.status).toBe("ANIMATION");
    const res = t.last("alice", "round:resolve")!;
    expect(res.revealed.map((r) => r.num).sort()).toEqual([1, 2]);
    expect(t.last("bob", "round:resolve")!.me.alive).toBe(true);
  });

  it("ignores a second submit (locked) and submits from players not in the room", () => {
    const t = setup();
    startTwoPlayerGame(t);
    t.room.submit("alice", { ...idle, shootDir: "N" });
    t.room.submit("alice", { ...idle, shootDir: "S" });
    t.room.submit("mallory", idle);
    vi.advanceTimersByTime(TIMING.inputMs + SUBMIT_GRACE_MS);
    expect(t.room.status).toBe("ANIMATION");
  });

  it("plays to the end and sends game:end to every human", () => {
    const t = setup();
    startTwoPlayerGame(t);
    // Nobody shoots: the arena shrinks to 2x2 and the 20-round cap ends it in a split pot.
    for (let r = 0; r < 25 && t.room.status !== "FINISHED"; r++) {
      vi.advanceTimersByTime(TIMING.inputMs + SUBMIT_GRACE_MS + TIMING.animationMs + TIMING.resultMs + 10);
    }
    expect(t.room.status).toBe("FINISHED");
    expect(t.last("alice", "game:end")).toEqual(t.last("bob", "game:end"));
    expect(t.last("alice", "game:end")!.reason).toBe("maxRounds");
  });

  it("resyncs a reconnecting player with the current round", () => {
    const t = setup();
    startTwoPlayerGame(t);
    t.room.disconnect("bob");
    expect(t.room.seatOf("bob")?.connected).toBe(false);
    const before = t.count("bob", "round:start");
    const res = t.room.join("bob", "Bob", "navy");
    expect(res).toEqual({ ok: true, num: 2 });
    expect(t.count("bob", "round:start")).toBe(before + 1);
    expect(t.last("bob", "round:start")!.deadline).toBe(t.room.deadline);
  });

  it("frees the seat when leaving the lobby and rejects joins after the start", () => {
    const t = setup();
    t.room.join("alice", "Alice", "soldier");
    t.room.join("bob", "Bob", "navy");
    t.room.leave("bob");
    expect(t.room.seats.map((s) => s.id)).toEqual(["alice"]);
    t.room.join("bob", "Bob", "navy");
    t.room.setReady("alice", true);
    t.room.setReady("bob", true);
    vi.advanceTimersByTime(TIMING.countdownMs);
    expect(t.room.join("carol", "Carol", "urban")).toEqual({ ok: false, error: "Game di room ini sudah dimulai." });
  });

  it("rejects a full room of humans but replaces a bot", () => {
    const t = setup({ maxPlayers: 2 });
    t.room.join("alice", "Alice", "soldier");
    t.room.join("bob", "Bob", "navy");
    expect(t.room.join("carol", "Carol", "urban")).toEqual({ ok: false, error: "Room penuh." });

    const u = setup({ maxPlayers: 2 });
    u.room.addBots(2);
    expect(u.room.join("alice", "Alice", "soldier").ok).toBe(true);
    expect(u.room.seats.filter((s) => s.isBot)).toHaveLength(1);
  });

  it("fills with bots for solo testing and starts with them", () => {
    const t = setup({ targetBots: 2 });
    t.room.join("alice", "Alice", "soldier");
    vi.advanceTimersByTime(5000);
    expect(t.room.seats.filter((s) => s.isBot)).toHaveLength(2);
    t.room.setReady("alice", true);
    vi.advanceTimersByTime(TIMING.countdownMs);
    expect(t.room.status).toBe("ROUND_INPUT");
    // Bots only exist server-side: nothing is ever sent to them.
    expect(t.inbox.every((m) => !m.to.startsWith("bot:"))).toBe(true);
  });

  it("reports an empty room once the last human leaves on purpose", () => {
    const onEmpty = vi.fn();
    const t = setup({ onEmpty });
    startTwoPlayerGame(t);
    t.room.leave("alice");
    expect(onEmpty).not.toHaveBeenCalled();
    t.room.leave("bob");
    expect(onEmpty).toHaveBeenCalledWith("ROOM1");
  });

  it("keeps a game running when the last human only drops, so they can come back", () => {
    const onEmpty = vi.fn();
    const t = setup({ onEmpty, targetBots: 2 });
    t.room.join("alice", "Alice", "soldier");
    vi.advanceTimersByTime(5000); // bots join
    t.room.setReady("alice", true);
    vi.advanceTimersByTime(TIMING.countdownMs);
    expect(t.room.status).toBe("ROUND_INPUT");
    t.room.disconnect("alice");
    expect(onEmpty).not.toHaveBeenCalled();
    expect(t.room.emptySince).not.toBeNull();
    t.room.join("alice", "Alice", "soldier"); // back within the round
    expect(t.room.emptySince).toBeNull();
    expect(t.last("alice", "round:start")?.round).toBe(1);
    t.room.disconnect("alice");
    // Timers keep running without anyone watching.
    vi.advanceTimersByTime(TIMING.inputMs + SUBMIT_GRACE_MS + 10);
    expect(t.room.status).toBe("ANIMATION");
  });

  it("does not send events to a seat that is not connected", () => {
    const t = setup();
    startTwoPlayerGame(t);
    t.room.disconnect("alice");
    const before = t.inbox.filter((m) => m.to === "alice").length;
    vi.advanceTimersByTime(TIMING.inputMs + SUBMIT_GRACE_MS + TIMING.animationMs);
    expect(t.inbox.filter((m) => m.to === "alice").length).toBe(before);
    expect(t.count("bob", "round:resolve")).toBe(1);
  });

  it("keeps the room when one player drops and the other walks out", () => {
    const onEmpty = vi.fn();
    const t = setup({ onEmpty });
    startTwoPlayerGame(t);
    t.room.disconnect("alice"); // may come back
    t.room.leave("bob");
    expect(onEmpty).not.toHaveBeenCalled();
    expect(t.room.emptySince).not.toBeNull();
  });

  it("counts a skill already submitted this round in the resync fees", () => {
    const t = setup();
    startTwoPlayerGame(t);
    t.room.submit("alice", { ...idle, skill: "shotgun", shootDir: "N" });
    t.room.join("alice", "Alice", "soldier");
    expect(t.last("alice", "round:start")!.fees).toBeGreaterThan(0);
  });

  it("makes a player who leaves mid-game forfeit", () => {
    const t = setup();
    startTwoPlayerGame(t);
    t.room.leave("alice");
    expect(t.room.engine!.players.find((p) => p.num === 1)!.alive).toBe(false);
    // Only Bob is left alive: his submit resolves the round early and he wins.
    t.room.submit("bob", idle);
    vi.advanceTimersByTime(1000 + TIMING.animationMs + TIMING.resultMs);
    expect(t.room.status).toBe("FINISHED");
    expect(t.last("bob", "game:end")).toMatchObject({ winners: [2], reason: "last", roomId: "ROOM1" });
  });

  it("restarts the countdown when someone leaves and everyone left is ready", () => {
    const t = setup();
    t.room.join("alice", "Alice", "soldier");
    t.room.join("bob", "Bob", "navy");
    t.room.join("carol", "Carol", "urban");
    t.room.setReady("alice", true);
    t.room.setReady("bob", true);
    t.room.leave("carol"); // the only one not ready walks out
    expect(t.room.status).toBe("COUNTDOWN");
    t.room.join("dave", "Dave", "urban");
    t.room.setReady("dave", true);
    t.room.disconnect("dave"); // drops during the countdown
    expect(t.room.status).toBe("COUNTDOWN");
    vi.advanceTimersByTime(TIMING.countdownMs);
    expect(t.room.status).toBe("ROUND_INPUT");
  });

  it("tells a reconnecting player they already locked in, with server fees", () => {
    const t = setup();
    startTwoPlayerGame(t);
    t.room.submit("alice", { ...idle, skill: "shotgun", shootDir: "N" });
    t.room.join("alice", "Alice", "soldier");
    const s = t.last("alice", "round:start")!;
    expect(s.locked).toBe(true);
    expect(s.roomId).toBe("ROOM1");
    expect(typeof s.serverNow).toBe("number");
    expect(t.last("bob", "round:start")!.locked).toBe(false);
  });

  it("accepts a submit that arrives just after the deadline", () => {
    const t = setup();
    startTwoPlayerGame(t);
    vi.advanceTimersByTime(TIMING.inputMs + SUBMIT_GRACE_MS / 2);
    expect(t.room.status).toBe("ROUND_INPUT");
    t.room.submit("alice", { ...idle, shootDir: "N" });
    t.room.submit("bob", idle);
    vi.advanceTimersByTime(1000);
    expect(t.room.status).toBe("ANIMATION");
    expect(t.last("alice", "round:resolve")!.revealed.find((p) => p.num === 1)!.facing).toBe("N");
  });

  it("never adds more bots than requested, even with quick joins", () => {
    const t = setup({ targetBots: 2, maxPlayers: 6 });
    t.room.join("alice", "Alice", "soldier");
    t.room.join("bob", "Bob", "navy");
    t.room.join("carol", "Carol", "urban");
    vi.advanceTimersByTime(10_000);
    expect(t.room.seats.filter((s) => s.isBot)).toHaveLength(2);
  });

  it("checks whether a join can succeed without changing anything", () => {
    const t = setup();
    startTwoPlayerGame(t);
    expect(t.room.canJoin("alice")).toBeNull();
    expect(t.room.canJoin("carol")).toBe("Game di room ini sudah dimulai.");
  });
});
