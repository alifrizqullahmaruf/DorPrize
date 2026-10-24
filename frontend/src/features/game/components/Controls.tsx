"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { sfx } from "@/shared/audio/sfx";
import { useGame } from "@/features/game/state/store";
import { isSolid } from "@dorprize/game-core";
import { aimDirOf, forwardOf, useView } from "@/features/game/state/view";

const MOUSE_SENS_X = 0.0028;
const MOUSE_SENS_Y = 0.0022;
const TOUCH_SENS_X = 0.007;
const TOUCH_SENS_Y = 0.005;
/** Walking speed in tiles per second. */
const WALK_SPEED = 3.2;

/** Current movement intent relative to the camera: fwd/right in [-1, 1]. */
const moveIntent = { fwd: 0, right: 0 };

/** Free walking: integrate movement every frame, blocked by lava and the board edge. */
function useWalkLoop() {
  useEffect(() => {
    let id = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.12, (now - last) / 1000);
      last = now;
      const g = useGame.getState();
      const v = useView.getState();
      const len = Math.hypot(moveIntent.fwd, moveIntent.right);
      if (g.phase === "input" && !g.locked && g.me.alive && g.round && len > 0.05 && !v.uiBlocked) {
        const k = Math.min(1, len) / len;
        const f = forwardOf(v.yaw);
        const r = forwardOf(v.yaw - Math.PI / 2);
        const vx = (f.x * moveIntent.fwd + r.x * moveIntent.right) * k * WALK_SPEED * dt;
        const vy = (f.y * moveIntent.fwd + r.y * moveIntent.right) * k * WALK_SPEED * dt;
        const n = g.round.boardSize;
        const ok = (x: number, y: number) => isSolid({ x: Math.round(x), y: Math.round(y) }, n, g.sunkRings);
        let { x, y } = v.walk;
        // Slide along blocked axes instead of stopping dead.
        if (ok(x + vx, y + vy)) {
          x += vx;
          y += vy;
        } else if (ok(x + vx, y)) x += vx;
        else if (ok(x, y + vy)) y += vy;
        const lim = (a: number) => Math.min(n - 0.6, Math.max(-0.4, a));
        x = lim(x);
        y = lim(y);
        v.setWalk(x, y);
        const t = useView.getState().walkTile;
        const d = g.draftTo ?? g.me;
        if (t.x !== d.x || t.y !== d.y) g.setDestination(t);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(id);
      moveIntent.fwd = 0;
      moveIntent.right = 0;
    };
  }, []);
}

function subscribeCoarse(cb: () => void) {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True on touch-first devices (phones/tablets). */
export function useIsTouch() {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

/** Keeps the shot direction in sync with where the camera looks. */
function useAimSync() {
  useEffect(() => {
    const sync = () => {
      const g = useGame.getState();
      const v = useView.getState();
      if (g.phase !== "input" || g.locked || !g.me.alive) return;
      // With the shield the direction is the facing it protects, so it always follows the camera.
      const want = v.holdFire && g.draftSkill !== "shield" ? null : aimDirOf(v.yaw);
      if (g.draftShoot !== want) g.setShoot(want);
    };
    const onRound = () => {
      const s = useGame.getState();
      // New round: everyone fires by default again, aim follows the camera.
      useView.getState().setHoldFire(false);
      useView.getState().setWalk(s.me.x, s.me.y);
      // First round: face the board centre so the player isn't staring at lava.
      if (s.round && s.round.round === 1) {
        const c = (s.round.boardSize - 1) / 2;
        const dx = c - s.me.x;
        const dy = c - s.me.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.01) useView.getState().setYaw(Math.atan2(dx, dy));
      }
      sync();
    };
    // Controls mount after round:start already arrived, so initialise now too.
    onRound();
    const unView = useView.subscribe(sync);
    const unGame = useGame.subscribe((s, prev) => {
      if (s.round !== prev.round) onRound();
      else if (s.draftSkill !== prev.draftSkill) sync();
    });
    return () => {
      unView();
      unGame();
    };
  }, []);
}

/** Input layer under the HUD: mouse-look + WASD on desktop, joystick + drag on touch. */
export function Controls() {
  const touch = useIsTouch();
  useEffect(() => useView.getState().loadSettings(), []);
  useAimSync();
  useWalkLoop();
  return touch ? <TouchControls /> : <DesktopControls />;
}

function DesktopControls() {
  const layer = useRef<HTMLDivElement>(null);
  const pointerLocked = useView((s) => s.pointerLocked);
  const uiBlocked = useView((s) => s.uiBlocked);
  const everLocked = useView((s) => s.everLocked);
  // Big "click to play" only the first time; afterwards (e.g. after Esc) a small reminder.
  const showPrompt = !pointerLocked && !uiBlocked && !everLocked;
  const showResume = !pointerLocked && !uiBlocked && everLocked;

  useEffect(() => {
    const el = layer.current;
    useView.getState().setLockTarget(el);
    const onLockChange = () => useView.getState().setPointerLocked(document.pointerLockElement === el);
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      const k = useView.getState().sensitivity;
      useView.getState().look(e.movementX * MOUSE_SENS_X * k, e.movementY * MOUSE_SENS_Y * k);
      useView.getState().markActive();
    };
    const map: Record<string, "w" | "a" | "s" | "d"> = {
      w: "w",
      a: "a",
      s: "s",
      d: "d",
      arrowup: "w",
      arrowleft: "a",
      arrowdown: "s",
      arrowright: "d",
    };
    const held = new Set<string>();
    const apply = () => {
      moveIntent.fwd = (held.has("w") ? 1 : 0) - (held.has("s") ? 1 : 0);
      moveIntent.right = (held.has("d") ? 1 : 0) - (held.has("a") ? 1 : 0);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = map[e.key.toLowerCase()];
      if (k) {
        held.delete(k);
        apply();
      }
    };
    const onBlur = () => {
      held.clear();
      apply();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || useView.getState().uiBlocked) return;
      const k = e.key.toLowerCase();
      if (map[k]) {
        e.preventDefault();
        useView.getState().markActive();
        held.add(map[k]);
        apply();
        return;
      }
      if (e.repeat) return;
      if (k === "f") {
        const v = useView.getState();
        v.setHoldFire(!v.holdFire);
        sfx.click();
      }
    };
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
      if (document.pointerLockElement === el) document.exitPointerLock();
      useView.getState().setPointerLocked(false);
      useView.getState().setLockTarget(null);
    };
  }, []);

  // One click hands the mouse to the game (browsers require a click for pointer lock).
  // After that, moving the mouse turns the camera and the aim directly — no dragging.
  const onClick = () => {
    const el = layer.current;
    if (!el || document.pointerLockElement === el) return;
    // Some browsers reject the request right after Esc; clicking again works.
    void Promise.resolve(el.requestPointerLock()).catch(() => {});
  };

  return (
    <div
      ref={layer}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      className={`absolute inset-0 select-none ${pointerLocked ? "cursor-none" : "cursor-pointer"}`}
    >
      {showPrompt && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 px-4">
          <div className="anim-pop max-w-md panel px-6 py-4 text-center">
            <div className="font-pixel text-xl text-gold sm:text-2xl">KLIK UNTUK MAIN</div>
            <div className="mt-1 text-xs text-stone sm:text-sm">
              Gerakkan <b>mouse</b> untuk memutar kamera &amp; membidik · <b>WASD</b> jalan · <b>1–4</b> skill ·{" "}
              <b>F</b> tahan tembak
            </div>
            <div className="mt-1 text-[11px] text-ash">
              Esc untuk melepas mouse · posisi terkunci otomatis saat waktu habis
            </div>
          </div>
        </div>
      )}
      {showResume && (
        <div className="pointer-events-none absolute inset-x-0 top-[58%] flex justify-center px-4">
          <div className="rounded-full bg-black/70 px-3 py-1 text-[11px] text-stone">
            Klik layar untuk kembali mengendalikan kamera
          </div>
        </div>
      )}
    </div>
  );
}

function TouchControls() {
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const stick = useRef<{ id: number; cx: number; cy: number; r: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const hintSeen = useView((s) => s.hintSeen);

  const onLookDown = (e: React.PointerEvent) => {
    if (look.current) return;
    look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onLookMove = (e: React.PointerEvent) => {
    const l = look.current;
    if (!l || l.id !== e.pointerId) return;
    const k = useView.getState().sensitivity;
    useView.getState().look((e.clientX - l.x) * TOUCH_SENS_X * k, (e.clientY - l.y) * TOUCH_SENS_Y * k);
    useView.getState().markActive();
    l.x = e.clientX;
    l.y = e.clientY;
  };
  const onLookUp = (e: React.PointerEvent) => {
    if (look.current?.id === e.pointerId) look.current = null;
  };

  const onStickDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const r = (rect.width / 2) * 0.82;
    stick.current = { id: e.pointerId, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, r };
    e.currentTarget.setPointerCapture(e.pointerId);
    onStickMove(e);
  };
  const onStickMove = (e: React.PointerEvent) => {
    const s = stick.current;
    if (!s || s.id !== e.pointerId) return;
    let dx = e.clientX - s.cx;
    let dy = e.clientY - s.cy;
    const len = Math.hypot(dx, dy);
    const R = s.r;
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    setKnob({ x: dx, y: dy });
    // Small dead zone, then analog speed like Roblox mobile.
    const m = len / R < 0.15 ? 0 : 1;
    if (m) useView.getState().markActive();
    moveIntent.fwd = (-dy / R) * m;
    moveIntent.right = (dx / R) * m;
  };
  const onStickUp = (e: React.PointerEvent) => {
    if (stick.current?.id !== e.pointerId) return;
    stick.current = null;
    moveIntent.fwd = 0;
    moveIntent.right = 0;
    setKnob({ x: 0, y: 0 });
  };

  return (
    <div
      className="absolute inset-0 touch-none"
      onPointerDown={onLookDown}
      onPointerMove={onLookMove}
      onPointerUp={onLookUp}
      onPointerCancel={onLookUp}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-[46%] [@media(max-height:520px)]:top-[32%] flex justify-center ${hintSeen ? "hidden" : ""}`}
      >
        <div className="text-center text-[11px] [@media(max-height:520px)]:text-[10px] text-stone/80 [text-shadow:0_1px_2px_#000]">
          Geser layar = bidik · Joystick = jalan
        </div>
      </div>
      <div
        className="absolute bottom-[144px] left-3 size-[104px] rounded-full border-2 border-white/10 bg-black/25 [@media(max-height:520px)]:bottom-[max(0.75rem,env(safe-area-inset-bottom))] [@media(max-height:520px)]:left-[max(0.75rem,env(safe-area-inset-left))] [@media(max-height:520px)]:size-[104px]"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
        aria-label="Joystick jalan"
      >
        <div
          className="absolute top-1/2 left-1/2 size-12 rounded-full border-2 border-white/25 bg-white/15"
          style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
        />
      </div>
    </div>
  );
}
