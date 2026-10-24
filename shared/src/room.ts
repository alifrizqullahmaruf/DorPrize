/**
 * One DOR PRIZE room: lobby, countdown, rounds, shootout and game end.
 *
 * Runs unchanged in the browser mock and on the Socket.io server. It never
 * talks to a network itself: every outgoing message goes through `send`, and
 * each human only ever receives their own secrets (position, mines).
 */
import { BOT_NAMES, decideBot } from "./bots";
import {
  canUseSkill,
  createGame,
  forfeit,
  personalize,
  resolveRound,
  roundStartFor,
  startRound,
  type EngineState,
  type Rng,
} from "./engine";
import type { PlayerPublic, RoomState, RoomStatus, RoomSummary, RoundSubmit, ServerEvents } from "./protocol";
import {
  DEFAULT_NAME,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NAME_MAX,
  SUBMIT_GRACE_MS,
  TIMING,
  boardSizeFor,
  roundCents,
  skillCost,
} from "./rules";
import { SKIN_IDS } from "./skins";

// Timer globals exist in every JS host (browser + Node); declared here so game-core
// stays free of DOM/Node type dependencies.
declare const setTimeout: (fn: () => void, ms: number) => unknown;
declare const clearTimeout: (handle: unknown) => void;

export type Seat = PlayerPublic & {
  /** Stable player id (guest id or wallet address); bots get "bot:<n>". */
  id: string;
  connected: boolean;
  /** Walked out of the running game on purpose (forfeited), unlike a dropped connection. */
  left?: boolean;
};

export type SendFn = <E extends keyof ServerEvents>(playerId: string, event: E, payload: ServerEvents[E]) => void;

export type TimerHandle = unknown;

export type RoomRunnerOptions = {
  roomId: string;
  name: string;
  /** Bid in USDC (display units). */
  bid: number;
  maxPlayers: number;
  isPrivate: boolean;
  /** Bots added automatically once a human joins (0 = humans only). */
  targetBots?: number;
  /** Phase-duration multiplier (1 = PRD timings; tests and ?fast use less). */
  timeScale?: number;
  send: SendFn;
  rng?: Rng;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  /** Called when the last human left on purpose (the host may delete the room). */
  onEmpty?: (roomId: string) => void;
};

export type JoinResult = { ok: true; num: number } | { ok: false; error: string };

const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Short, unambiguous room code (no 0/O, 1/I). */
export function makeRoomId(rng: () => number = Math.random) {
  let id = "";
  for (let i = 0; i < 6; i++) id += ROOM_ID_ALPHABET[Math.floor(rng() * ROOM_ID_ALPHABET.length)];
  return id;
}

export class RoomRunner {
  readonly roomId: string;
  readonly name: string;
  readonly bid: number;
  readonly maxPlayers: number;
  readonly isPrivate: boolean;

  status: RoomStatus = "LOBBY";
  seats: Seat[] = [];
  engine: EngineState | null = null;
  countdownEndsAt: number | null = null;
  /** Epoch ms when the current input phase ends. */
  deadline: number | null = null;
  readonly createdAt: number;
  /** Epoch ms since when no human is connected (null while someone is). */
  emptySince: number | null = null;

  private targetBots: number;
  private scale: number;
  private send: SendFn;
  private rng: Rng;
  private now: () => number;
  private setTimer: (fn: () => void, ms: number) => TimerHandle;
  private clearTimer: (h: TimerHandle) => void;
  private onEmpty?: (roomId: string) => void;
  private timers: TimerHandle[] = [];
  private actions: Record<number, RoundSubmit> = {};
  private lastResolve: ReturnType<typeof resolveRound> | null = null;

  constructor(opts: RoomRunnerOptions) {
    this.roomId = opts.roomId;
    this.name = opts.name;
    this.bid = opts.bid;
    this.maxPlayers = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.floor(opts.maxPlayers)));
    this.isPrivate = opts.isPrivate;
    this.targetBots = Math.max(0, Math.min(this.maxPlayers - 1, Math.floor(opts.targetBots ?? 0)));
    this.scale = opts.timeScale ?? 1;
    this.send = opts.send;
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));
    this.onEmpty = opts.onEmpty;
    this.createdAt = this.now();
  }

  // ------------------------------------------------------------------ queries

  get humans() {
    return this.seats.filter((s) => !s.isBot);
  }

  /** Humans who currently receive events. */
  private get audience() {
    return this.humans.filter((s) => s.connected);
  }

  private get inLobby() {
    return this.status === "LOBBY" || this.status === "COUNTDOWN";
  }

  /** Listed publicly and still joinable. */
  get isOpen() {
    return !this.isPrivate && this.status === "LOBBY";
  }

  /** Board size follows the player count until the game starts. */
  private get boardSize() {
    return this.engine ? this.engine.n : boardSizeFor(Math.max(1, this.seats.length));
  }

  seatOf(playerId: string) {
    return this.seats.find((s) => s.id === playerId);
  }

  summary(): RoomSummary {
    return {
      roomId: this.roomId,
      name: this.name,
      bid: this.bid,
      boardSize: this.boardSize,
      maxPlayers: this.maxPlayers,
      players: this.seats.length,
      isPrivate: this.isPrivate,
      status: this.status,
    };
  }

  stateFor(playerId: string | null): RoomState {
    const alive = new Map(this.engine?.players.map((p) => [p.num, p.alive]) ?? []);
    const me = playerId ? this.seatOf(playerId) : undefined;
    return {
      roomId: this.roomId,
      name: this.name,
      status: this.status,
      bid: this.bid,
      pot: this.bid * this.seats.length,
      boardSize: this.boardSize,
      maxPlayers: this.maxPlayers,
      isPrivate: this.isPrivate,
      players: this.seats.map(({ num, name, skin, ready, isBot }) => ({
        num,
        name,
        skin,
        ready,
        isBot,
        alive: alive.get(num) ?? true,
      })),
      meNum: me?.num ?? null,
      countdownEndsAt: this.countdownEndsAt,
      round: this.engine?.round ?? 0,
      serverNow: this.now(),
    };
  }

  // ------------------------------------------------------------------ players

  /** Why `playerId` cannot join right now, or null if they can. */
  canJoin(playerId: string): string | null {
    if (this.seatOf(playerId)) return null;
    if (this.status !== "LOBBY") return "Game di room ini sudah dimulai.";
    if (this.seats.length >= this.maxPlayers && !this.seats.some((s) => s.isBot)) return "Room penuh.";
    return null;
  }

  /** Join (or re-join after a reconnect). */
  join(playerId: string, name: string, skin: string): JoinResult {
    const error = this.canJoin(playerId);
    if (error) return { ok: false, error };
    this.emptySince = null;
    const existing = this.seatOf(playerId);
    if (existing) {
      existing.connected = true;
      existing.left = false;
      existing.name = name || existing.name;
      this.resync(existing);
      return { ok: true, num: existing.num };
    }
    if (this.seats.length >= this.maxPlayers) {
      // Make space for a human by dropping a bot (canJoin checked there is one).
      const botIdx = this.seats.findIndex((s) => s.isBot);
      if (botIdx < 0) return { ok: false, error: "Room penuh." };
      this.seats.splice(botIdx, 1);
    }
    const seat: Seat = {
      id: playerId,
      num: this.nextNum(),
      name: name.slice(0, NAME_MAX) || DEFAULT_NAME,
      skin: SKIN_IDS.includes(skin) ? skin : SKIN_IDS[0],
      ready: false,
      alive: true,
      connected: true,
    };
    this.seats.push(seat);
    this.pushState();
    this.fillBots();
    return { ok: true, num: seat.num };
  }

  setSkin(playerId: string, skin: string) {
    const seat = this.seatOf(playerId);
    if (!seat || this.status !== "LOBBY" || !SKIN_IDS.includes(skin)) return;
    seat.skin = skin;
    this.pushState();
  }

  /** Ready up. The countdown starts once every seated player is ready (min. 2). */
  setReady(playerId: string, ready: boolean) {
    const seat = this.seatOf(playerId);
    if (!seat) return;
    if (this.status === "COUNTDOWN" && !ready) {
      // Someone backed out: cancel the countdown.
      seat.ready = false;
      this.cancelCountdown();
      this.pushState();
      this.fillBots();
      return;
    }
    if (this.status !== "LOBBY") return;
    seat.ready = ready;
    // Solo testing with bots: make sure there is an opponent.
    if (ready && this.seats.length < MIN_PLAYERS && this.targetBots > 0) this.addBot();
    if (!this.maybeStartCountdown()) this.pushState();
  }

  /** Leave on purpose. Before the start the seat is freed; in-game the player forfeits. */
  leave(playerId: string) {
    const seat = this.seatOf(playerId);
    if (!seat) return;
    if (this.inLobby) {
      this.freeSeat(playerId);
    } else {
      seat.connected = false;
      seat.left = true;
      const p = this.engine?.players.find((q) => q.num === seat.num);
      if (this.engine && p?.alive && !this.engine.end) {
        this.engine = forfeit(this.engine, seat.num);
        this.pushState();
        if (this.status === "ROUND_INPUT") this.maybeEarlyResolve();
      }
    }
    // Delete right away only if every human walked out; players who merely
    // dropped may still come back (the host sweeps abandoned games).
    if (this.checkEmpty() && this.humans.every((s) => s.left)) this.onEmpty?.(this.roomId);
  }

  /**
   * Connection dropped. In the lobby the seat is freed; in-game the player
   * stays alive and the game keeps running so they can come back.
   */
  disconnect(playerId: string) {
    const seat = this.seatOf(playerId);
    if (!seat) return;
    if (this.inLobby) this.freeSeat(playerId);
    else seat.connected = false;
    this.checkEmpty();
  }

  submit(playerId: string, action: RoundSubmit) {
    const seat = this.seatOf(playerId);
    if (!seat || this.status !== "ROUND_INPUT" || !this.engine) return;
    const p = this.engine.players.find((q) => q.num === seat.num);
    if (!p?.alive || this.actions[seat.num]) return; // dead or already locked
    this.actions[seat.num] = action;
    this.maybeEarlyResolve();
  }

  /** Add bots right away (used to seed demo rooms). */
  addBots(count: number) {
    for (let i = 0; i < count; i++) this.addBot();
    this.pushState();
  }

  dispose() {
    this.clearTimers();
  }

  // ------------------------------------------------------------------ game loop

  private startGame() {
    this.countdownEndsAt = null;
    this.engine = createGame(
      boardSizeFor(this.seats.length),
      this.seats.map((s) => s.num),
      this.bid,
      this.rng,
    );
    this.nextRound();
  }

  private nextRound() {
    if (!this.engine) return;
    this.engine = startRound(this.engine);
    this.actions = {};
    this.lastResolve = null;
    this.status = "ROUND_INPUT";
    this.deadline = this.now() + TIMING.inputMs * this.scale;
    this.pushState();
    for (const seat of this.audience) this.sendRoundStart(seat);
    // Bots "think" for a moment.
    for (const seat of this.seats.filter((s) => s.isBot)) {
      const p = this.engine.players.find((q) => q.num === seat.num);
      if (!p?.alive) continue;
      this.later(1500 + this.rng() * 5000, () => {
        if (this.status !== "ROUND_INPUT" || !this.engine) return;
        this.actions[seat.num] = decideBot(this.engine, seat.num, this.rng);
        this.maybeEarlyResolve();
      });
    }
    // Late submits (latency, clock skew) still count within the grace window.
    this.timers.push(this.setTimer(() => this.resolve(), TIMING.inputMs * this.scale + SUBMIT_GRACE_MS));
  }

  /** End the input phase early once every living player has locked in. */
  private maybeEarlyResolve() {
    if (!this.engine) return;
    const pending = this.engine.players.filter((p) => p.alive && !this.actions[p.num]);
    if (pending.length === 0) {
      this.clearTimers();
      this.later(800, () => this.resolve());
    }
  }

  private resolve() {
    if (this.status !== "ROUND_INPUT" || !this.engine) return;
    this.clearTimers();
    const result = resolveRound(this.engine, this.actions, this.rng);
    this.engine = result.state;
    this.lastResolve = result;
    this.deadline = null;
    this.status = "ANIMATION";
    this.pushState();
    for (const seat of this.audience) this.sendResolve(seat);
    this.later(TIMING.animationMs, () => {
      this.status = "RESULT";
      this.pushState();
      this.later(TIMING.resultMs, () => {
        if (result.state.end) {
          this.status = "FINISHED";
          this.pushState();
          for (const seat of this.audience) this.sendEnd(seat);
        } else {
          this.nextRound();
        }
      });
    });
  }

  // ------------------------------------------------------------------ helpers

  /** Bring a (re)connected player up to date with the current phase. */
  private resync(seat: Seat) {
    this.send(seat.id, "room:state", this.stateFor(seat.id));
    if (!this.engine) return;
    if (this.status === "ROUND_INPUT") this.sendRoundStart(seat);
    else if (this.status === "ANIMATION" || this.status === "RESULT") this.sendResolve(seat);
    else if (this.status === "FINISHED") this.sendEnd(seat);
  }

  // The engine knows nothing about rooms or clocks: room fields are added here.
  private sendRoundStart(seat: Seat) {
    if (!this.engine || this.deadline === null) return;
    const start = roundStartFor(this.engine, seat.num, this.deadline);
    // A skill already submitted this round is charged at resolve; count it now.
    const skill = this.actions[seat.num]?.skill;
    const p = this.engine.players.find((q) => q.num === seat.num);
    const pending = skill && p && canUseSkill(p, skill) ? skillCost(skill, this.bid) : 0;
    this.send(seat.id, "round:start", {
      ...start,
      fees: roundCents(start.fees + pending),
      roomId: this.roomId,
      serverNow: this.now(),
      locked: !!this.actions[seat.num],
    });
  }

  private sendResolve(seat: Seat) {
    if (!this.engine || !this.lastResolve) return;
    this.send(seat.id, "round:resolve", {
      ...personalize(this.lastResolve.shared, this.engine, seat.num),
      roomId: this.roomId,
    });
  }

  private sendEnd(seat: Seat) {
    if (this.engine?.end) this.send(seat.id, "game:end", { ...this.engine.end, roomId: this.roomId });
  }

  private pushState() {
    for (const seat of this.audience) this.send(seat.id, "room:state", this.stateFor(seat.id));
  }

  /** Free a seat before the start; a cancelled countdown restarts if everyone left is still ready. */
  private freeSeat(playerId: string) {
    this.seats = this.seats.filter((s) => s.id !== playerId);
    if (this.status === "COUNTDOWN") this.cancelCountdown();
    if (!this.maybeStartCountdown()) this.pushState();
  }

  /** Start the countdown once every seated player is ready (min. 2). */
  private maybeStartCountdown() {
    if (this.status !== "LOBBY" || this.seats.length < MIN_PLAYERS || !this.seats.every((s) => s.ready)) {
      return false;
    }
    this.clearTimers();
    this.status = "COUNTDOWN";
    this.countdownEndsAt = this.now() + TIMING.countdownMs * this.scale;
    this.pushState();
    this.later(TIMING.countdownMs, () => this.startGame());
    return true;
  }

  private nextNum() {
    const used = new Set(this.seats.map((s) => s.num));
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }

  private addBot() {
    if (this.seats.length >= this.maxPlayers) return;
    const taken = new Set(this.seats.map((s) => s.name));
    const num = this.nextNum();
    this.seats.push({
      id: `bot:${num}`,
      num,
      name: BOT_NAMES.find((b) => !taken.has(b)) ?? `Bot${num}`,
      skin: SKIN_IDS[Math.floor(this.rng() * SKIN_IDS.length)],
      ready: true,
      alive: true,
      isBot: true,
      connected: true,
    });
  }

  private fillBots() {
    const bots = this.seats.filter((s) => s.isBot).length;
    if (this.status !== "LOBBY" || bots >= this.targetBots || this.humans.length === 0) return;
    this.later(600 + this.rng() * 900, () => {
      // Several joins may have scheduled a fill: re-check the count.
      if (this.status !== "LOBBY" || this.seats.filter((s) => s.isBot).length >= this.targetBots) return;
      this.addBot();
      this.pushState();
      this.fillBots();
    });
  }

  /** Returns true when no human is connected any more. */
  private checkEmpty() {
    if (this.audience.length > 0) return false;
    this.emptySince ??= this.now();
    // An empty lobby stops and drops its bots. A running game keeps going so a
    // dropped player can reconnect; the host sweeps it if nobody comes back.
    if (this.inLobby) {
      this.cancelCountdown();
      this.seats = this.seats.filter((s) => !s.isBot);
    }
    return true;
  }

  private cancelCountdown() {
    this.clearTimers();
    this.status = "LOBBY";
    this.countdownEndsAt = null;
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(this.setTimer(fn, ms * this.scale));
  }

  private clearTimers() {
    this.timers.forEach((t) => this.clearTimer(t));
    this.timers = [];
  }
}
