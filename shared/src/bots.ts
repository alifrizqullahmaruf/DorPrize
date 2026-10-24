import { canUseSkill, type EngineState, type Rng } from "./engine";
import { DIRS, allTiles, inBoard, isSolid, sameTile, step } from "./geometry";
import type { RoundSubmit, Skill, Tile } from "./protocol";
import { SKILL_ORDER } from "./rules";

export const BOT_NAMES = [
  "Jagoan_Lava",
  "MasDor",
  "BangSniper",
  "Kopral_Kopi",
  "NengRanjau",
  "SiBuntung",
  "PakEko99",
  "Rizky.exe",
  "Cimol_Gaming",
  "Tukang_Tembak",
  "Gorengan",
  "AyamGeprek",
];

/** A light heuristic: walk to a random tile, shoot in a random open direction. */
export function decideBot(state: EngineState, num: number, rng: Rng): RoundSubmit {
  const p = state.players.find((q) => q.num === num);
  if (!p || !p.alive) return { moveTo: null, shootDir: null, skill: null, mineAt: null };
  const n = state.n;

  // Walk anywhere: pick a random tile that is still standing.
  const tiles = allTiles(n).filter((t) => isSolid(t, n, state.sunkRings));
  const stay = rng() < 0.2;
  const dest: Tile = stay || tiles.length === 0 ? { x: p.x, y: p.y } : tiles[Math.floor(rng() * tiles.length)];
  const moveTo = sameTile(dest, p) ? null : dest;

  // Bots are as blind as everyone else: random direction that isn't
  // pointing straight off the board, and sometimes they hold fire.
  const open = DIRS.filter((d) => inBoard(step(dest, d), n));
  const shootDir = rng() < 0.3 || open.length === 0 ? null : open[Math.floor(rng() * open.length)];

  let skill: Skill | null = null;
  if (rng() < 0.22) {
    const usable = SKILL_ORDER.filter((s) => canUseSkill(p, s));
    if (usable.length) skill = usable[Math.floor(rng() * usable.length)];
  }
  // Bots drop mines where they start the round.
  return { moveTo, shootDir, skill, mineAt: skill === "mine" ? { x: p.x, y: p.y } : null };
}
