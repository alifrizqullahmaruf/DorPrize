/**
 * Round resolver, following the PRD resolution order. Runs inside RoomRunner,
 * both in the browser mock and on the game server.
 */
import {
  allTiles,
  applyMoveTo,
  pushInside,
  shrinkRingFor,
  inBoard,
  isSolid,
  opposite,
  ringOf,
  sameTile,
  shotDirs,
  step,
} from "./geometry";
import type {
  Block,
  Death,
  Dir,
  GameEnd,
  MineBlast,
  RoundResolve,
  RoundStart,
  RoundSubmit,
  Shot,
  ShotPath,
  Skill,
  Tile,
} from "./protocol";
import { MAX_ROUNDS, SKILLS, roundCents, skillCost } from "./rules";

export type Rng = () => number;

export type EnginePlayer = {
  num: number;
  x: number;
  y: number;
  alive: boolean;
  helm: boolean;
  facing: Dir;
  cooldowns: Record<Skill, number>;
  kills: number;
  fees: number;
};

export type EngineMine = { owner: number; x: number; y: number };

export type EngineState = {
  n: number;
  bid: number;
  round: number;
  sunkRings: number;
  players: EnginePlayer[];
  mines: EngineMine[];
  end: EngineEnd | null;
  /** Shrink that happened at the start of the current round. */
  lastShrink: { ring: number; pushed: number[] } | null;
};

// The engine knows nothing about rooms or clocks; RoomRunner adds those fields.
export type EngineEnd = Omit<GameEnd, "roomId">;
export type EngineRoundStart = Omit<RoundStart, "roomId" | "serverNow" | "locked">;
export type SharedResolve = Omit<RoundResolve, "roomId" | "me" | "myMines">;

export const NO_COOLDOWN: Record<Skill, number> = { mine: 0, shotgun: 0, shield: 0, goldHelm: 0 };

function shuffle<T>(arr: T[], rng: Rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createGame(n: number, nums: number[], bid: number, rng: Rng): EngineState {
  const all = allTiles(n);
  const inner = n > 3 ? all.filter((t) => ringOf(t, n) >= 1) : all;
  const pool = shuffle(inner.length >= nums.length ? inner : all, rng);
  const players = nums.map((num, i) => {
    const t = pool[i % pool.length];
    return {
      num,
      x: t.x,
      y: t.y,
      alive: true,
      helm: false,
      facing: (["N", "E", "S", "W"] as Dir[])[Math.floor(rng() * 4)],
      cooldowns: { ...NO_COOLDOWN },
      kills: 0,
      fees: 0,
    };
  });
  return { n, bid, round: 0, sunkRings: 0, players, mines: [], end: null, lastShrink: null };
}

/**
 * Advance to the next round: bump round counter, tick cooldowns and shrink the
 * arena. Players on the sinking ring are pushed inwards (lava never kills);
 * mines on it are destroyed without exploding.
 */
export function startRound(state: EngineState): EngineState {
  const round = state.round + 1;
  const ring = shrinkRingFor(round, state.n);
  const sunkRings = ring === null ? state.sunkRings : ring + 1;
  const pushed: number[] = [];
  const players = state.players.map((p) => {
    const next = {
      ...p,
      cooldowns: Object.fromEntries(Object.entries(p.cooldowns).map(([k, v]) => [k, Math.max(0, v - 1)])) as Record<
        Skill,
        number
      >,
    };
    if (ring !== null && p.alive && ringOf(p, state.n) < sunkRings) {
      const t = pushInside(p, state.n, sunkRings);
      next.x = t.x;
      next.y = t.y;
      pushed.push(p.num);
    }
    return next;
  });
  return {
    ...state,
    round,
    sunkRings,
    players,
    mines: ring === null ? state.mines : state.mines.filter((m) => ringOf(m, state.n) >= sunkRings),
    lastShrink: ring === null ? null : { ring, pushed },
  };
}

export function canUseSkill(p: Pick<EnginePlayer, "alive" | "helm" | "cooldowns">, skill: Skill) {
  if (!p.alive) return false;
  if (p.cooldowns[skill] > 0) return false;
  if (skill === "goldHelm" && p.helm) return false;
  return true;
}

/** What only player `num` may know: their own position and mines. */
function privateView(state: EngineState, num: number) {
  const p = state.players.find((q) => q.num === num);
  return {
    p,
    me: p ? { x: p.x, y: p.y, alive: p.alive, helm: p.helm } : { x: 0, y: 0, alive: false, helm: false },
    myMines: state.mines.filter((m) => m.owner === num).map(({ x, y }) => ({ x, y })),
  };
}

export function roundStartFor(state: EngineState, num: number, deadline: number): EngineRoundStart {
  const { p, me, myMines } = privateView(state, num);
  return {
    round: state.round,
    deadline,
    boardSize: state.n,
    me,
    cooldowns: p ? { ...p.cooldowns } : { ...NO_COOLDOWN },
    shrunkRing: state.lastShrink?.ring ?? null,
    pushed: !!state.lastShrink?.pushed.includes(num),
    sunkRings: state.sunkRings,
    myMines,
    fees: p?.fees ?? 0,
  };
}

type Hit = { attacker: number; travel: Dir | null; source: "shot" | "mine" };

export function resolveRound(
  prev: EngineState,
  actions: Record<number, RoundSubmit | undefined>,
  rng: Rng,
): { state: EngineState; shared: SharedResolve } {
  const n = prev.n;
  const players = prev.players.map((p) => ({ ...p, cooldowns: { ...p.cooldowns } }));
  let mines = prev.mines.map((m) => ({ ...m }));
  const alive = players.filter((p) => p.alive);

  // Validate skills and charge fees.
  const used = new Map<number, Skill>();
  for (const p of alive) {
    const a = actions[p.num];
    if (a?.skill && canUseSkill(p, a.skill)) {
      used.set(p.num, a.skill);
      p.cooldowns[a.skill] = SKILLS[a.skill].cooldown;
      p.fees = roundCents(p.fees + skillCost(a.skill, prev.bid));
    }
    if (a?.shootDir) p.facing = a.shootDir;
  }

  // 1. Defensive skills.
  const shielded = new Set<number>();
  for (const p of alive) {
    const s = used.get(p.num);
    if (s === "goldHelm") p.helm = true;
    if (s === "shield") shielded.add(p.num);
  }

  // 2. Mines on the tile the player stood on when buying (any standing tile).
  for (const p of alive) {
    if (used.get(p.num) === "mine") {
      const want = actions[p.num]?.mineAt;
      const at = want && isSolid(want, n, prev.sunkRings) ? want : { x: p.x, y: p.y };
      mines = mines.filter((m) => !(m.x === at.x && m.y === at.y && m.owner === p.num));
      mines.push({ owner: p.num, x: at.x, y: at.y });
    }
  }

  // 3. Simultaneous movement.
  for (const p of alive) {
    const t = applyMoveTo(p, actions[p.num]?.moveTo ?? null, n, prev.sunkRings);
    p.x = t.x;
    p.y = t.y;
  }

  const hits = new Map<number, Hit[]>();
  const addHit = (num: number, h: Hit) => hits.set(num, [...(hits.get(num) ?? []), h]);

  // Snapshot for the reveal (after moving, before damage).
  const revealed = alive.map((p) => ({
    num: p.num,
    at: { x: p.x, y: p.y },
    facing: actions[p.num]?.shootDir ?? (shielded.has(p.num) ? p.facing : null),
    weapon: (used.get(p.num) === "shotgun" ? "shotgun" : "pistol") as "pistol" | "shotgun",
    shield: shielded.has(p.num),
    helm: p.helm,
  }));

  // 4. Mines explode for other players ending on them.
  const mineBlasts: MineBlast[] = [];
  mines = mines.filter((m) => {
    const victims = alive.filter((p) => p.num !== m.owner && p.x === m.x && p.y === m.y);
    if (victims.length === 0) return true;
    victims.forEach((v) => addHit(v.num, { attacker: m.owner, travel: null, source: "mine" }));
    mineBlasts.push({ at: { x: m.x, y: m.y }, victimNums: victims.map((v) => v.num) });
    return false;
  });

  // 5. Shots from the destination tile.
  const shots: Shot[] = [];
  for (const p of shuffle(alive, rng)) {
    const dir = actions[p.num]?.shootDir;
    // Shielded players only defend this round: no shot.
    if (!dir || shielded.has(p.num)) continue;
    const weapon = used.get(p.num) === "shotgun" ? "shotgun" : "pistol";
    const paths: ShotPath[] = shotDirs(dir, weapon === "shotgun").map((d, i) => {
      const hitNums: number[] = [];
      // Same-tile players are hit from any direction (once per shot).
      for (const q of alive) {
        if (i === 0 && q.num !== p.num && sameTile(q, p)) {
          addHit(q.num, { attacker: p.num, travel: null, source: "shot" });
          hitNums.push(q.num);
        }
      }
      let cur: Tile = { x: p.x, y: p.y };
      let to: Tile = cur;
      for (;;) {
        const nxt = step(cur, d);
        if (!inBoard(nxt, n)) {
          to = cur;
          break;
        }
        cur = nxt;
        const there = alive.filter((q) => q.num !== p.num && sameTile(q, cur));
        if (there.length > 0) {
          there.forEach((q) => {
            addHit(q.num, { attacker: p.num, travel: d, source: "shot" });
            hitNums.push(q.num);
          });
          to = cur;
          break;
        }
      }
      return { dir: d, from: { x: p.x, y: p.y }, to, hitNums };
    });
    shots.push({ shooterNum: p.num, weapon, paths });
  }

  // 6. Apply all damage at once.
  const blocks: Block[] = [];
  const deaths: Death[] = [];
  for (const p of alive) {
    let list = hits.get(p.num) ?? [];
    if (list.length === 0) continue;
    if (shielded.has(p.num)) {
      const blocked = list.filter((h) => h.source === "shot" && h.travel === opposite(p.facing));
      if (blocked.length > 0) {
        blocks.push({ num: p.num, by: "shield", at: { x: p.x, y: p.y }, dir: p.facing });
        list = list.filter((h) => !blocked.includes(h));
      }
    }
    if (list.length > 0 && p.helm) {
      p.helm = false;
      blocks.push({ num: p.num, by: "helm", at: { x: p.x, y: p.y }, dir: null });
      list = list.slice(1);
    }
    if (list.length > 0) {
      const killers = [...new Set(list.map((h) => h.attacker))];
      deaths.push({ num: p.num, cause: list[0].source, at: { x: p.x, y: p.y }, killerNums: killers });
    }
  }
  for (const d of deaths) {
    const p = players.find((q) => q.num === d.num)!;
    p.alive = false;
    for (const k of d.killerNums) {
      const killer = players.find((q) => q.num === k);
      if (killer) killer.kills += 1;
    }
  }

  // 7. Win check. (The arena shrinks at the start of the next round.)
  const survivors = players.filter((p) => p.alive);
  let end: EngineEnd | null = null;
  const pot = prev.bid * players.length;
  const base = {
    pot,
    skillFees: Object.fromEntries(players.map((p) => [p.num, p.fees])),
    kills: Object.fromEntries(players.map((p) => [p.num, p.kills])),
  };
  const finish = (winners: number[], reason: GameEnd["reason"]): EngineEnd => ({
    ...base,
    winners,
    reason,
    payoutEach: Math.floor((pot / winners.length) * 100) / 100,
  });
  if (survivors.length === 1) end = finish([survivors[0].num], "last");
  else if (survivors.length === 0)
    end = finish(
      deaths.map((d) => d.num),
      "mutual",
    );
  else if (prev.round >= MAX_ROUNDS)
    end = finish(
      survivors.map((p) => p.num),
      "maxRounds",
    );

  return {
    state: { ...prev, players, mines, end },
    shared: {
      round: prev.round,
      revealed,
      mineBlasts,
      shots,
      blocks,
      deaths,
    },
  };
}

export function personalize(shared: SharedResolve, state: EngineState, num: number): Omit<RoundResolve, "roomId"> {
  const { me, myMines } = privateView(state, num);
  return { ...shared, me, myMines };
}

/** A player who walks out of a running game is out: dead, bid stays in the pot. */
export function forfeit(state: EngineState, num: number): EngineState {
  return { ...state, players: state.players.map((p) => (p.num === num ? { ...p, alive: false } : p)) };
}
