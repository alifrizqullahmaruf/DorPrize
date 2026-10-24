import type { Dir, Tile } from "./protocol";

export const DIRS: Dir[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Grid vectors. x grows east, y grows south. */
export const DIR_VEC: Record<Dir, Tile> = {
  N: { x: 0, y: -1 },
  NE: { x: 1, y: -1 },
  E: { x: 1, y: 0 },
  SE: { x: 1, y: 1 },
  S: { x: 0, y: 1 },
  SW: { x: -1, y: 1 },
  W: { x: -1, y: 0 },
  NW: { x: -1, y: -1 },
};

export function rotate(dir: Dir, steps: number): Dir {
  const i = DIRS.indexOf(dir);
  return DIRS[(((i + steps) % 8) + 8) % 8];
}

export function opposite(dir: Dir): Dir {
  return rotate(dir, 4);
}

export function step(t: Tile, dir: Dir | null): Tile {
  if (!dir) return { ...t };
  const v = DIR_VEC[dir];
  return { x: t.x + v.x, y: t.y + v.y };
}

export function sameTile(a: Tile, b: Tile) {
  return a.x === b.x && a.y === b.y;
}

export function inBoard(t: Tile, n: number) {
  return t.x >= 0 && t.y >= 0 && t.x < n && t.y < n;
}

/** Ring index: 0 is the outermost ring. */
export function ringOf(t: Tile, n: number) {
  return Math.min(t.x, t.y, n - 1 - t.x, n - 1 - t.y);
}

/** How many rings sink in total before the 2×2 core (3×3 for odd sizes). */
export function maxSinkRings(n: number) {
  if (n <= 3) return 0;
  return Math.floor((n - 2) / 2);
}

/**
 * Ring that sinks at the *start* of round `round` (1-based). Round 1 is played
 * on the full board; every later round removes the outermost ring until 2×2.
 */
export function shrinkRingFor(round: number, n: number) {
  const ring = round - 2;
  return ring >= 0 && ring < maxSinkRings(n) ? ring : null;
}

/** Push a tile inwards onto the nearest tile that is still standing. */
export function pushInside(t: Tile, n: number, sunkRings: number): Tile {
  const lo = sunkRings;
  const hi = n - 1 - sunkRings;
  return { x: Math.min(hi, Math.max(lo, t.x)), y: Math.min(hi, Math.max(lo, t.y)) };
}

/** Every tile of an n×n board, row by row. */
export function allTiles(n: number): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) tiles.push({ x, y });
  return tiles;
}

/** A tile is solid ground if its ring has not sunk yet. */
export function isSolid(t: Tile, n: number, sunkRings: number) {
  return inBoard(t, n) && ringOf(t, n) >= sunkRings;
}

/** Destination after a free move: any solid tile, otherwise stay. */
export function applyMoveTo(t: Tile, to: Tile | null, n: number, sunkRings: number) {
  return to && isSolid(to, n, sunkRings) ? { x: to.x, y: to.y } : { x: t.x, y: t.y };
}

/** Last tile inside the board walking from `t` along `dir` (excluding nothing). */
export function edgeFrom(t: Tile, dir: Dir, n: number) {
  let cur = { ...t };
  for (;;) {
    const nxt = step(cur, dir);
    if (!inBoard(nxt, n)) return cur;
    cur = nxt;
  }
}

/** Snap an angle (radians, grid space: +x east, +y south) to the nearest Dir. */
export function dirFromVector(dx: number, dy: number): Dir | null {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return null;
  // angle measured from north, clockwise
  const ang = Math.atan2(dx, -dy);
  const idx = Math.round(ang / (Math.PI / 4));
  return DIRS[((idx % 8) + 8) % 8];
}

/** Directions one shot travels: the aim, plus ±45° for a shotgun. */
export function shotDirs(dir: Dir, shotgun: boolean): Dir[] {
  return shotgun ? [dir, rotate(dir, -1), rotate(dir, 1)] : [dir];
}
