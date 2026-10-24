import { DIR_VEC } from "@dorprize/game-core";
import type { Dir, Tile } from "@dorprize/game-core";

/** Height of the gun / laser above the tile surface. */
export const GUN_Y = 0.58;

export function tileToWorld(t: Tile, n: number, y = 0): [number, number, number] {
  return [t.x - (n - 1) / 2, y, t.y - (n - 1) / 2];
}

export function worldToTile(x: number, z: number, n: number): Tile {
  return { x: Math.round(x + (n - 1) / 2), y: Math.round(z + (n - 1) / 2) };
}

/** Y rotation that makes a model face `dir` (south when null). */
export function facingToRotation(dir: Dir | null) {
  if (!dir) return 0;
  const v = DIR_VEC[dir];
  return Math.atan2(v.x, v.y);
}
