"use client";

import { create } from "zustand";
import { getTransport, type GameTransport } from "@/features/game/net/transport";
import { applyMoveTo, canUseSkill, isSolid, NO_COOLDOWN, roundCents, skillCost } from "@dorprize/game-core";
import type { Death, Dir, GameEnd, RoomState, RoundResolve, RoundStart, Skill, Tile } from "@dorprize/game-core";
import { buildTimeline, shotIndexHitting } from "@/features/game/state/timeline";
import { useAfter } from "@/shared/hooks/useAfter";

export type Phase = "idle" | "lobby" | "countdown" | "input" | "animation" | "result" | "finished";

export type Corpse = Death & { round: number; skin: string };

export type FeedItem = {
  id: number;
  text: string;
  tone: "kill" | "lava" | "mine" | "info";
  /** performance.now() ms when the item may be shown (after its animation beat). */
  showAt: number;
};

type GameState = {
  transport: GameTransport | null;
  phase: Phase;
  /** Room this tab joined; events for any other room are ignored. */
  roomId: string | null;
  room: RoomState | null;
  error: string;
  round: RoundStart | null;
  me: { x: number; y: number; alive: boolean; helm: boolean };
  cooldowns: Record<Skill, number>;
  /** Ring that sank at the start of this round (for the shrink animation). */
  shrunkRing: number | null;
  /** performance.now() when the current round started (shrink animation clock). */
  roundAt: number;
  /** I was pushed inwards by the shrink this round. */
  pushed: boolean;
  sunkRings: number;
  myMines: Tile[];
  facing: Dir;
  /** Planned destination (null = stay). */
  draftTo: Tile | null;
  draftShoot: Dir | null;
  draftSkill: Skill | null;
  /** Where the mine goes (the tile I stood on when buying it). */
  draftMineAt: Tile | null;
  locked: boolean;
  /** Fees spent on skills this game (for affordability). */
  spent: number;
  resolve: RoundResolve | null;
  /** performance.now() when the resolve animation started. */
  resolveAt: number;
  corpses: Corpse[];
  feed: FeedItem[];
  end: GameEnd | null;
  /** performance.now() ms when my own death plays out (null while alive). */
  meDeadAt: number | null;
  connect: () => Promise<GameTransport>;
  join: (roomId: string, name: string, skin: string) => Promise<void>;
  setSkin: (skin: string) => void;
  setReady: (ready: boolean) => void;
  leave: () => void;
  /** Set the planned destination tile (free movement). */
  setDestination: (t: Tile | null) => void;
  setShoot: (dir: Dir | null) => void;
  /** Select/unselect a skill. `at` = tile under the player (used to drop a mine). */
  toggleSkill: (skill: Skill, at?: Tile) => void;
  lock: () => void;
};

let unsubs: (() => void)[] = [];
let feedId = 0;

const statusToPhase: Record<RoomState["status"], Phase> = {
  LOBBY: "lobby",
  COUNTDOWN: "countdown",
  ROUND_INPUT: "input",
  ANIMATION: "animation",
  RESULT: "result",
  FINISHED: "finished",
  SETTLED: "finished",
};

/** Convert a server epoch timestamp to this device's clock. */
const toLocalTime = (at: number, serverNow: number) => at - serverNow + Date.now();

const initial = {
  phase: "idle" as Phase,
  roomId: null as string | null,
  room: null,
  error: "",
  round: null,
  me: { x: 0, y: 0, alive: true, helm: false },
  cooldowns: NO_COOLDOWN,
  shrunkRing: null as number | null,
  roundAt: 0,
  pushed: false,
  sunkRings: 0,
  myMines: [],
  facing: "N" as Dir,
  draftTo: null as Tile | null,
  draftShoot: null,
  draftSkill: null,
  draftMineAt: null as Tile | null,
  locked: false,
  spent: 0,
  resolve: null,
  resolveAt: 0,
  corpses: [],
  feed: [],
  end: null,
  meDeadAt: null as number | null,
};

export const useGame = create<GameState>((set, get) => ({
  transport: null,
  ...initial,

  connect: async () => {
    const existing = get().transport;
    if (existing) return existing;
    const t = await getTransport();
    unsubs.forEach((u) => u());
    // A player may still get events from a room they left, or that another tab is in.
    const isCurrent = (roomId: string) => roomId === get().roomId;
    unsubs = [
      t.on("room:state", (incoming) => {
        if (!isCurrent(incoming.roomId)) return;
        const room =
          incoming.countdownEndsAt === null
            ? incoming
            : { ...incoming, countdownEndsAt: toLocalTime(incoming.countdownEndsAt, incoming.serverNow) };
        const prev = get();
        let phase = statusToPhase[room.status];
        // Keep showing the input UI until round:start arrives for the next round.
        if (phase === "input" && prev.round?.round !== room.round) phase = prev.phase;
        set({ room, phase: prev.end ? "finished" : phase });
      }),
      t.on("round:start", (incoming) => {
        if (!isCurrent(incoming.roomId)) return;
        const round = { ...incoming, deadline: toLocalTime(incoming.deadline, incoming.serverNow) };
        set({
          round,
          // Players shot last round are removed from the board.
          corpses: [],
          phase: "input",
          me: round.me,
          cooldowns: round.cooldowns,
          shrunkRing: round.shrunkRing,
          roundAt: performance.now(),
          pushed: round.pushed,
          feed:
            round.shrunkRing !== null
              ? [
                  ...get().feed,
                  {
                    id: ++feedId,
                    showAt: 0,
                    tone: "lava" as const,
                    text: `Arena menyusut jadi ${round.boardSize - 2 * round.sunkRings}×${round.boardSize - 2 * round.sunkRings}`,
                  },
                ].slice(-6)
              : get().feed,
          sunkRings: round.sunkRings,
          myMines: round.myMines,
          draftTo: null,
          draftSkill: null,
          draftMineAt: null,
          draftShoot: round.me.alive ? get().facing : null,
          // Already submitted (e.g. resync after a reconnect): stay locked.
          locked: !round.me.alive || round.locked,
          spent: round.fees,
          resolve: null,
        });
      }),
      t.on("round:resolve", (res) => {
        if (!isCurrent(res.roomId)) return;
        const { room, corpses, feed } = get();
        const nameOf = (num: number) => room?.players.find((p) => p.num === num)?.name ?? `#${num}`;
        const skinOf = (num: number) => room?.players.find((p) => p.num === num)?.skin ?? "soldier";
        const at = performance.now();
        const tl = buildTimeline(res);
        const newFeed: FeedItem[] = res.deaths.map((d) => ({
          id: ++feedId,
          showAt: at + tl.deathAt,
          tone: d.cause === "mine" ? "mine" : "kill",
          text:
            d.cause === "mine"
              ? `#${d.killerNums[0]} meledakkan #${d.num} ${nameOf(d.num)}`
              : `${d.killerNums.map((k) => `#${k}`).join(" & ")} menembak #${d.num} ${nameOf(d.num)}`,
        }));
        // Helmets knocked off and shots stopped by shields also go to the feed.
        for (const b of res.blocks) {
          const shooter = res.shots[shotIndexHitting(res, b.num)]?.shooterNum;
          newFeed.push({
            id: ++feedId,
            showAt: at + tl.deathAt,
            tone: "info",
            text:
              b.by === "helm"
                ? `${shooter ? `#${shooter}` : "Ranjau"} menjatuhkan helm emas #${b.num} ${nameOf(b.num)}`
                : `Tameng #${b.num} ${nameOf(b.num)} menahan tembakan`,
          });
        }
        set({
          resolve: res,
          resolveAt: at,
          phase: "animation",
          me: res.me,
          meDeadAt: (() => {
            if (get().meDeadAt !== null) return get().meDeadAt;
            const mine = res.deaths.find((d) => d.num === room?.meNum);
            if (!mine) return res.me.alive ? null : at;
            return at + tl.deathAt;
          })(),
          myMines: res.myMines,
          corpses: [...corpses, ...res.deaths.map((d) => ({ ...d, round: res.round, skin: skinOf(d.num) }))],
          feed: [...feed, ...newFeed].slice(-6),
        });
      }),
      t.on("game:end", (end) => {
        if (isCurrent(end.roomId)) set({ end, phase: "finished" });
      }),
      t.on("room:error", ({ message }) => set({ error: message })),
    ];
    set({ transport: t });
    return t;
  },

  join: async (roomId, name, skin) => {
    let t: GameTransport;
    try {
      t = await get().connect();
    } catch (e) {
      set({ ...initial, error: e instanceof Error ? e.message : "Tidak bisa terhubung ke server game." });
      return;
    }
    // Room codes are case-insensitive; hosts store them upper-case.
    set({ ...initial, phase: "lobby", roomId: roomId.toUpperCase() });
    t.emit("room:join", { roomId, name, skin });
  },

  setSkin: (skin) => get().transport?.emit("room:skin", { skin }),
  setReady: (ready) => get().transport?.emit("room:ready", { ready }),

  leave: () => {
    const { transport, room } = get();
    if (transport && room) transport.emit("room:leave", { roomId: room.roomId });
    set({ ...initial });
  },

  setDestination: (t) => {
    const s = get();
    if (s.locked || !s.round) return;
    const ok = t && isSolid(t, s.round.boardSize, s.sunkRings) && !(t.x === s.me.x && t.y === s.me.y);
    set({ draftTo: ok ? { x: t.x, y: t.y } : null });
  },
  setShoot: (dir) => {
    if (get().locked) return;
    set({ draftShoot: dir, facing: dir ?? get().facing });
  },
  toggleSkill: (skill, at) => {
    const s = get();
    if (s.locked || !canUseSkill({ ...s.me, cooldowns: s.cooldowns }, skill)) return;
    const on = s.draftSkill !== skill;
    set({
      draftSkill: on ? skill : null,
      draftMineAt: on && skill === "mine" ? (at ?? { x: s.me.x, y: s.me.y }) : null,
    });
  },
  lock: () => {
    const s = get();
    if (s.locked || s.phase !== "input" || !s.me.alive) return;
    s.transport?.emit("round:submit", {
      moveTo: s.draftTo,
      shootDir: s.draftShoot,
      skill: s.draftSkill,
      mineAt: s.draftSkill === "mine" ? s.draftMineAt : null,
    });
    const fee = s.draftSkill && s.room ? skillCost(s.draftSkill, s.room.bid) : 0;
    set({ locked: true, spent: roundCents(s.spent + fee) });
  },
}));

/** Destination tile for the current draft move (for laser + preview). */
export function draftTarget(s: Pick<GameState, "me" | "draftTo" | "round" | "sunkRings">) {
  const n = s.round?.boardSize ?? 0;
  return applyMoveTo(s.me, s.draftTo, n, s.sunkRings);
}

/** True once my death has been shown (grayscale / spectator UI). */
export function useDeathShown() {
  const meDeadAt = useGame((s) => s.meDeadAt);
  const alive = useGame((s) => s.me.alive);
  const passed = useAfter(meDeadAt ?? Number.POSITIVE_INFINITY);
  return !alive && meDeadAt !== null && passed;
}
