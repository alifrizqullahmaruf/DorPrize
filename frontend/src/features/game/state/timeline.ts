import { TIMING } from "@dorprize/game-core";
import type { RoundResolve } from "@dorprize/game-core";

/** Phase-duration multiplier for the mock: ?fast=1 shortens, ?slow=1 stretches (debugging). */
export function timeScale() {
  if (typeof window === "undefined") return 1;
  const q = new URLSearchParams(window.location.search);
  return q.get("fast") ? 0.4 : q.get("slow") ? 3 : 1;
}

export type Timeline = {
  total: number;
  moveEnd: number;
  mineAt: number[];
  shotAt: number[];
  slot: number;
  deathAt: number;
};

/**
 * Turn a simultaneous resolve into a sequential, dramatic playback
 * ("Giliran #N") that fits the animation phase. All times in ms from the
 * start of the resolve animation.
 */
export function buildTimeline(res: RoundResolve): Timeline {
  const total = TIMING.animationMs * timeScale();
  // Reveal pause: everyone appears with their lasers before the first shot.
  const moveEnd = total * 0.2;
  const mineSlot = total * 0.1;
  const mineAt = res.mineBlasts.map((_, i) => moveEnd + i * mineSlot);
  const shotsStart = moveEnd + res.mineBlasts.length * mineSlot + total * 0.02;
  const shotsBudget = total * 0.86 - shotsStart;
  const slot = res.shots.length ? Math.min(total * 0.14, shotsBudget / res.shots.length) : 0;
  const shotAt = res.shots.map((_, i) => shotsStart + i * slot);
  const deathAt = shotsStart + res.shots.length * slot;
  return { total, moveEnd, mineAt, shotAt, slot, deathAt };
}

/** Index of the shot (if any) whose hit list includes `num`. */
export function shotIndexHitting(res: RoundResolve, num: number) {
  return res.shots.findIndex((s) => s.paths.some((p) => p.hitNums.includes(num)));
}

/** When a block (helm knocked off / shield hit) on `num` lands, in ms from the resolve start. */
export function hitAt(tl: Timeline, res: RoundResolve, num: number) {
  const i = shotIndexHitting(res, num);
  return (i >= 0 ? tl.shotAt[i] : tl.deathAt) + 150;
}
