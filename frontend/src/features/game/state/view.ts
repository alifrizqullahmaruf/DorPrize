"use client";

import { create } from "zustand";
import { dirFromVector } from "@dorprize/game-core";
import type { Dir, Tile } from "@dorprize/game-core";

/**
 * Third-person camera state (Roblox "shift lock" style).
 * yaw: 0 looks towards grid +y (south), increasing turns towards +x (east).
 * Forward vector in grid space is (sin yaw, cos yaw).
 */
type ViewState = {
  yaw: number;
  pitch: number;
  pointerLocked: boolean;
  /** The player has moved or looked around at least once (hides the controls hint). */
  hintSeen: boolean;
  markActive: () => void;
  /** Mouse/touch look sensitivity multiplier (saved in the browser). */
  sensitivity: number;
  setSensitivity: (v: number) => void;
  loadSettings: () => void;
  /** A modal is open: game hotkeys and walking are paused. */
  uiBlocked: boolean;
  setUiBlocked: (v: boolean) => void;
  /** Player chose not to shoot this round (F). */
  holdFire: boolean;
  setHoldFire: (v: boolean) => void;
  /** Free-walk position in grid units (floats) during the input phase. */
  walk: { x: number; y: number };
  /** Tile currently under the walker (changes only when crossing tiles). */
  walkTile: Tile;
  setWalk: (x: number, y: number) => void;
  look: (dx: number, dy: number) => void;
  setYaw: (yaw: number) => void;
  setPointerLocked: (v: boolean) => void;
  /** The mouse has been captured at least once this session (big prompt only shows before that). */
  everLocked: boolean;
  /** Element that owns pointer lock (the desktop controls layer). */
  lockTarget: HTMLElement | null;
  setLockTarget: (el: HTMLElement | null) => void;
  /** Release the mouse for a modal and remember to take it back afterwards. */
  releaseForModal: () => void;
  /** Re-capture the mouse after a modal closes. Must run inside a click/key handler. */
  relock: () => void;
  relockWanted: boolean;
};

export const SENS_MIN = 0.3;
export const SENS_MAX = 3;
const SENS_KEY = "dorprize.sensitivity";

export const PITCH_MIN = 0.12;
export const PITCH_MAX = 1.15;

export const useView = create<ViewState>((set, get) => ({
  yaw: 0,
  pitch: 0.62,
  pointerLocked: false,
  hintSeen: false,
  markActive: () => {
    if (!get().hintSeen) set({ hintSeen: true });
  },
  sensitivity: 1,
  setSensitivity: (sensitivity) => {
    set({ sensitivity });
    try {
      localStorage.setItem(SENS_KEY, String(sensitivity));
    } catch {
      // storage blocked: setting lasts for this session only
    }
  },
  loadSettings: () => {
    try {
      const v = Number(localStorage.getItem(SENS_KEY));
      if (Number.isFinite(v) && v >= SENS_MIN && v <= SENS_MAX) set({ sensitivity: v });
    } catch {
      // ignore
    }
  },
  uiBlocked: false,
  setUiBlocked: (uiBlocked) => set({ uiBlocked }),
  holdFire: false,
  setHoldFire: (holdFire) => set({ holdFire }),
  walk: { x: 0, y: 0 },
  walkTile: { x: 0, y: 0 },
  setWalk: (x, y) => {
    const tx = Math.round(x);
    const ty = Math.round(y);
    const cur = get().walkTile;
    set(cur.x === tx && cur.y === ty ? { walk: { x, y } } : { walk: { x, y }, walkTile: { x: tx, y: ty } });
  },
  look: (dx, dy) => {
    const { yaw, pitch } = get();
    set({
      yaw: yaw - dx,
      pitch: Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch + dy)),
    });
  },
  setYaw: (yaw) => set({ yaw }),
  setPointerLocked: (pointerLocked) => set(pointerLocked ? { pointerLocked, everLocked: true } : { pointerLocked }),
  everLocked: false,
  lockTarget: null,
  setLockTarget: (lockTarget) => set({ lockTarget }),
  relockWanted: false,
  releaseForModal: () => {
    if (typeof document === "undefined" || !document.pointerLockElement) return;
    set({ relockWanted: true });
    document.exitPointerLock();
  },
  relock: () => {
    const { relockWanted, lockTarget } = get();
    set({ relockWanted: false });
    if (!relockWanted || !lockTarget || document.pointerLockElement) return;
    void Promise.resolve(lockTarget.requestPointerLock()).catch(() => {});
  },
}));

export function forwardOf(yaw: number) {
  return { x: Math.sin(yaw), y: Math.cos(yaw) };
}

/** Camera direction snapped to the 8 legal shooting directions. */
export function aimDirOf(yaw: number): Dir {
  const f = forwardOf(yaw);
  return dirFromVector(f.x, f.y) ?? "S";
}
