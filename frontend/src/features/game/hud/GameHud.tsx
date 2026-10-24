"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { sfx } from "@/shared/audio/sfx";
import { canUseSkill, formatUsdc, MAX_ROUNDS, SKILL_ORDER, skillCost, SKILLS } from "@dorprize/game-core";
import type { Skill } from "@dorprize/game-core";
import { useDeathShown, useGame } from "@/features/game/state/store";
import { useAfter } from "@/shared/hooks/useAfter";
import { secondsUntil, useNow } from "@/shared/hooks/useNow";
import { useView } from "@/features/game/state/view";
import { buildTimeline, hitAt, type Timeline } from "@/features/game/state/timeline";
import { useAccountView } from "@/features/wallet/account";
import { ResultModal } from "@/features/game/hud/ResultModal";
import { SettingsModal } from "@/features/game/hud/SettingsModal";
import { SkillConfirmModal } from "@/features/game/hud/SkillConfirmModal";
import { SkillIcon, UsdcIcon } from "@/shared/ui/icons";
import { ASSET_SYMBOL, NATIVE_MODE } from "@/shared/backend/native";

/**
 * performance.now() clock for the resolve animation. Everything the HUD shows
 * changes only at known moments (mines, shots, deaths, feed items), so it ticks
 * at those boundaries instead of every frame.
 */
function useAnimClock(boundaries: number[] | null) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!boundaries) return;
    const tick = () => setNow(performance.now());
    const ids = [0, ...boundaries].map((at) => setTimeout(tick, Math.max(0, at - performance.now())));
    return () => ids.forEach(clearTimeout);
  }, [boundaries]);
  return now;
}

/** Moments (performance.now() ms) where the animation HUD changes. */
function animBoundaries(resolveAt: number, tl: Timeline, feedShowAt: number[]) {
  const mineSlot = tl.total * 0.1;
  return [...tl.mineAt.flatMap((t) => [t, t + mineSlot]), ...tl.shotAt, tl.deathAt]
    .map((t) => resolveAt + t)
    .concat(feedShowAt);
}

export function GameHud() {
  const g = useGame(
    useShallow((s) => ({
      room: s.room,
      phase: s.phase,
      round: s.round,
      me: s.me,
      resolve: s.resolve,
      resolveAt: s.resolveAt,
      locked: s.locked,
      spent: s.spent,
      cooldowns: s.cooldowns,
      draftSkill: s.draftSkill,
      shrunkRing: s.shrunkRing,
      roundAt: s.roundAt,
      pushed: s.pushed,
      feed: s.feed,
      end: s.end,
    })),
  );
  const account = useAccountView();
  const { room, phase, round, me, resolve, resolveAt } = g;
  const meNum = room?.meNum ?? null;
  const now = useNow(phase === "input" || phase === "countdown");
  const deathShown = useDeathShown();
  const holdFire = useView((s) => s.holdFire);
  const timeline = useMemo(() => (resolve ? buildTimeline(resolve) : null), [resolve]);
  const animating = phase === "animation" && !!resolve;
  const boundaries = useMemo(
    () =>
      animating && timeline
        ? animBoundaries(
            resolveAt,
            timeline,
            g.feed.map((f) => f.showAt),
          )
        : null,
    [animating, timeline, resolveAt, g.feed],
  );
  const perfNow = useAnimClock(boundaries);
  const bid = room?.bid ?? 0;
  const budget = (NATIVE_MODE ? (account.skillBudget ?? 0) : account.available) - g.spent;

  const secondsLeft =
    phase === "input" && round
      ? secondsUntil(round.deadline, now)
      : phase === "countdown" && room?.countdownEndsAt
        ? secondsUntil(room.countdownEndsAt, now)
        : 0;

  // Countdown ticks.
  const lastTick = useRef(-1);
  useEffect(() => {
    const tickWindow = phase === "countdown" ? 5 : 3;
    if (
      (phase === "countdown" || phase === "input") &&
      secondsLeft > 0 &&
      secondsLeft <= tickWindow &&
      lastTick.current !== secondsLeft
    ) {
      lastTick.current = secondsLeft;
      sfx.tick();
    }
  }, [phase, secondsLeft]);

  // The round locks ONLY when the timer runs out (no manual lock): submit
  // whatever is planned just before the deadline.
  useEffect(() => {
    if (phase !== "input" || g.locked || !me.alive || !round) return;
    const wait = round.deadline - Date.now() - (NATIVE_MODE ? 900 : 400);
    const id = setTimeout(() => useGame.getState().lock(), Math.max(0, wait));
    return () => clearTimeout(id);
  }, [phase, g.locked, me.alive, round]);

  // Schedule sounds for the resolve playback.
  useEffect(() => {
    if (!resolve || !timeline) return;
    const ids: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) =>
      ids.push(setTimeout(fn, Math.max(0, resolveAt + ms - performance.now())));
    timeline.mineAt.forEach((t) => at(t, sfx.boom));
    resolve.shots.forEach((s, i) => at(timeline.shotAt[i], s.weapon === "shotgun" ? sfx.shotgun : sfx.shot));
    resolve.blocks.forEach((b) => at(hitAt(timeline, resolve, b.num), sfx.clink));
    return () => ids.forEach(clearTimeout);
  }, [resolve, resolveAt, timeline]);

  // Arena shrink at the start of a round: rumble + banner for a couple of seconds.
  const shrinking = phase === "input" && g.shrunkRing !== null;
  const shrinkOver = useAfter(shrinking ? g.roundAt + 2400 : null);
  useEffect(() => {
    if (shrinking) sfx.rumble();
  }, [shrinking, g.roundAt]);

  // Buying a skill asks for confirmation first (it is charged to the wallet).
  const [pendingSkill, setPendingSkill] = useState<Skill | null>(null);
  const canAct = phase === "input" && !g.locked && me.alive;
  const confirmOpen = pendingSkill !== null && canAct;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const modalOpen = confirmOpen || settingsOpen;
  useEffect(() => {
    useView.getState().setUiBlocked(modalOpen);
    if (modalOpen) useView.getState().releaseForModal();
    return () => useView.getState().setUiBlocked(false);
  }, [modalOpen]);

  const trySkill = (skill: Skill) => {
    const s = useGame.getState();
    if (s.draftSkill === skill) {
      // Un-selecting is free: nothing is charged until the round is locked.
      s.toggleSkill(skill);
      sfx.click();
      return;
    }
    if (skillCost(skill, bid) > budget) return;
    if (!canUseSkill({ ...s.me, cooldowns: s.cooldowns }, skill)) return;
    setPendingSkill(skill);
    sfx.click();
  };
  const confirmSkill = () => {
    const skill = pendingSkill;
    setPendingSkill(null);
    // Take the mouse back right away (we're inside the click/Enter handler).
    useView.getState().relock();
    if (!skill) return;
    const s = useGame.getState();
    // A mine is dropped on the tile I'm standing on right now.
    if (s.draftSkill !== skill) s.toggleSkill(skill, useView.getState().walkTile);
    sfx.lock();
  };
  const cancelSkill = () => {
    setPendingSkill(null);
    useView.getState().relock();
  };

  // Keyboard controls, registered once; trySkill is read through a ref.
  const trySkillRef = useRef(trySkill);
  useEffect(() => {
    trySkillRef.current = trySkill;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const s = useGame.getState();
      if (s.phase !== "input" || s.locked || !s.me.alive || useView.getState().uiBlocked) return;
      const k = e.key.toLowerCase();
      if (["1", "2", "3", "4"].includes(k)) {
        const skill = SKILL_ORDER[Number(k) - 1];
        trySkillRef.current(skill);
      }
    };
    // Space must never act in-game: browsers "press" a focused button on Space.
    const blockSpace = (e: KeyboardEvent) => {
      if (e.key === " " && !(e.target instanceof HTMLInputElement)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", blockSpace, true);
    window.addEventListener("keyup", blockSpace, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", blockSpace, true);
      window.removeEventListener("keyup", blockSpace, true);
    };
  }, []);

  if (!room) return null;

  const hiddenDeaths =
    phase === "animation" && resolve && timeline && perfNow < resolveAt + timeline.deathAt ? resolve.deaths.length : 0;
  const alive = room.players.filter((p) => p.alive).length + hiddenDeaths;
  const elapsed = resolve ? perfNow - resolveAt : 0;

  // ---- phase banner ----
  let banner = "";
  let sub = "";
  let tone: "gold" | "red" | "stone" = "stone";
  if (phase === "countdown") {
    banner = `BERSIAP ${secondsLeft}`;
    sub = "Lawan hanya terlihat saat adu tembak";
    tone = "gold";
  } else if (phase === "input" && shrinking && !shrinkOver && round) {
    const side = round.boardSize - 2 * round.sunkRings;
    banner = "ARENA MENYUSUT!";
    sub = g.pushed ? `Kamu terdorong ke dalam · arena sekarang ${side}×${side}` : `Arena sekarang ${side}×${side}`;
    tone = "red";
  } else if (phase === "input") {
    if (!me.alive) {
      banner = `RONDE ${round?.round ?? ""}`;
      sub = "Kamu menonton";
    } else if (g.locked) {
      banner = `TERKUNCI ${secondsLeft}`;
      sub = "Menunggu pemain lain…";
    } else {
      banner = `LANGKAH & BIDIK ${secondsLeft}`;
      sub = "Jalan bebas ke petak mana saja · posisi saat waktu habis = posisi akhir";
      tone = secondsLeft <= 5 ? "red" : "gold";
    }
  } else if (phase === "animation" && resolve && timeline) {
    const i = timeline.shotAt.findIndex(
      (t, idx) => elapsed >= t && elapsed < (timeline.shotAt[idx + 1] ?? timeline.deathAt),
    );
    const mineActive = timeline.mineAt.some((t) => elapsed >= t && elapsed < t + timeline.total * 0.1);
    tone = "red";
    if (mineActive) {
      banner = "RANJAU MELEDAK!";
    } else if (i >= 0) {
      const s = resolve.shots[i];
      banner = `GILIRAN #${s.shooterNum}`;
      const hit = s.paths.flatMap((p) => p.hitNums);
      const helm = resolve.blocks.find((b) => b.by === "helm" && hit.includes(b.num));
      const shield = resolve.blocks.find((b) => b.by === "shield" && hit.includes(b.num));
      sub = helm
        ? `KENA! Helm emas #${helm.num} jatuh`
        : shield
          ? `Ditahan tameng #${shield.num}`
          : s.weapon === "shotgun"
            ? "SHOTGUN — DOR DOR DOR!"
            : "DOR!";
    } else if (elapsed < (timeline.shotAt[0] ?? timeline.deathAt)) {
      banner = "TERUNGKAP!";
      sub = resolve.shots.length
        ? "Semua pemain terlihat — DOR sebentar lagi"
        : "Semua pemain terlihat — tidak ada yang menembak";
      tone = "gold";
    } else {
      const k = resolve.deaths.length;
      const helms = resolve.blocks.filter((b) => b.by === "helm").length;
      const shields = resolve.blocks.filter((b) => b.by === "shield").length;
      banner = k ? `${k} TUMBANG` : helms ? "HELM EMAS JATUH!" : shields ? "DITAHAN TAMENG!" : "MELESET SEMUA";
      sub = k && helms ? `${helms} helm emas jatuh` : "";
      tone = k || helms ? "red" : "stone";
    }
  } else if (phase === "result") {
    banner = `HASIL RONDE ${resolve?.round ?? room.round}`;
    sub = `${alive} pemain bertahan`;
  } else if (phase === "lobby") {
    banner = "LOBI";
  }

  const toneClass = tone === "gold" ? "text-gold" : tone === "red" ? "text-[#ff6b5a]" : "text-stone";

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* top center: phase */}
      {banner && (
        <div className="absolute inset-x-0 top-3 flex justify-center px-3 sm:top-4">
          <div key={banner.replace(/\d+/g, "")} className="anim-pop panel px-4 py-2 text-center">
            <div className={`font-pixel text-base leading-tight sm:text-2xl ${toneClass}`}>{banner}</div>
            {sub && <div className="mt-0.5 text-[11px] text-ash sm:text-xs">{sub}</div>}
          </div>
        </div>
      )}

      {/* top left: round / pot / alive */}
      <div className="absolute top-20 left-3 flex flex-col gap-1.5 lg:top-4">
        <div className="flex items-center gap-3 panel px-3 py-2 font-pixel text-xs sm:text-sm">
          <span>
            RONDE <b className="text-gold">{room.round || "-"}</b>
            <span className="text-ash">/{MAX_ROUNDS}</span>
          </span>
          <span className="flex items-center gap-1">
            <UsdcIcon size={14} />
            <b className="text-gold">{formatUsdc(room.pot)}</b>
          </span>
          <span>
            HIDUP <b className="text-stone">{alive}</b>
            <span className="text-ash">/{room.players.length}</span>
          </span>
        </div>
        <div className="flex gap-1.5">
          <div className="panel px-3 py-1.5 text-[11px] text-ash sm:text-xs">
            Saldo skill: <b className="text-gold">{formatUsdc(Math.max(0, budget))}</b> {ASSET_SYMBOL}
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="pointer-events-auto panel px-2.5 text-sm text-stone hover:text-gold"
            aria-label="Pengaturan"
            title="Pengaturan (sensitivitas mouse, suara)"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* top right: kill feed */}
      <div className="absolute top-40 right-3 flex w-[min(260px,60vw)] flex-col items-end gap-1 sm:top-20 lg:top-4">
        {g.feed
          .filter((f) => phase !== "animation" || f.showAt <= perfNow)
          .map((f) => (
            <div
              key={f.id}
              className={`anim-pop panel px-2 py-1 text-right text-[11px] sm:text-xs ${
                f.tone === "lava" ? "text-lava" : f.tone === "mine" ? "text-gold" : "text-stone"
              }`}
            >
              {f.text}
            </div>
          ))}
      </div>

      {/* crosshair (third-person aim) */}
      {!deathShown && phase === "input" && me.alive && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className={`relative size-6 ${holdFire ? "opacity-30" : ""}`}>
            <span className="absolute top-0 left-1/2 h-2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_2px_#000]" />
            <span className="absolute bottom-0 left-1/2 h-2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_2px_#000]" />
            <span className="absolute top-1/2 left-0 h-0.5 w-2 -translate-y-1/2 bg-white shadow-[0_0_2px_#000]" />
            <span className="absolute top-1/2 right-0 h-0.5 w-2 -translate-y-1/2 bg-white shadow-[0_0_2px_#000]" />
            <span className="absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-danger" />
          </div>
          {g.draftSkill === "shield" && (
            <div className="mt-2 -translate-x-1/3 rounded bg-[#0d2a3a]/90 px-2 py-0.5 font-pixel text-[10px] whitespace-nowrap text-[#5cc8ff]">
              TAMENG · tidak menembak
            </div>
          )}
        </div>
      )}

      {/* bottom controls */}
      {!deathShown && (phase === "input" || phase === "animation" || phase === "result") && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-3 sm:p-4">
          <div className="pointer-events-auto flex gap-1.5 sm:gap-2">
            {SKILL_ORDER.map((s) => {
              const def = SKILLS[s];
              const cd = g.cooldowns[s];
              const cost = skillCost(s, bid);
              const selected = g.draftSkill === s;
              const helmBlocked = s === "goldHelm" && me.helm;
              const poor = !selected && cost > budget;
              const disabled = !canAct || !canUseSkill({ ...me, cooldowns: g.cooldowns }, s) || poor;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => trySkill(s)}
                  disabled={disabled}
                  title={`${def.name}: ${def.description}`}
                  className={`relative flex w-[68px] flex-col items-center rounded-lg border-2 px-1 pt-2 pb-1.5 transition sm:w-[84px] ${
                    selected
                      ? "border-gold bg-[#3a2a08] shadow-[0_0_14px_#f5b82e88]"
                      : "border-white/10 bg-black/75 hover:bg-black/90"
                  } disabled:opacity-45`}
                >
                  <span className="absolute top-0.5 left-1 font-pixel text-[9px] text-ash">{def.hotkey}</span>
                  <SkillIcon skill={s} size={30} />
                  <span className="mt-1 font-pixel text-[9px] leading-none text-stone sm:text-[10px]">{def.name}</span>
                  <span className="mt-0.5 font-pixel text-[10px] text-gold">${formatUsdc(cost)}</span>
                  {(cd > 0 || helmBlocked) && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/70 font-pixel text-sm text-stone">
                      {helmBlocked ? "AKTIF" : `${cd}R`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="pointer-events-auto flex items-end gap-3">
            <button
              type="button"
              disabled={!canAct}
              onClick={() => {
                useView.getState().setHoldFire(!holdFire);
                sfx.click();
              }}
              aria-pressed={holdFire}
              className={`h-[72px] w-[78px] rounded-lg border-2 font-pixel text-[11px] leading-tight transition sm:h-[78px] ${
                holdFire ? "border-gold bg-[#3a2a08] text-gold" : "border-white/10 bg-black/75 text-stone"
              } disabled:opacity-45`}
              title="Tidak menembak ronde ini"
            >
              {holdFire ? "TIDAK DOR" : "TAHAN DOR"}
              <span className="block text-[9px] font-normal text-ash">F</span>
            </button>
            {/* No lock button: the round locks automatically when the timer ends. */}
            <div
              className={`flex h-[72px] w-[92px] flex-col items-center justify-center rounded-lg border-2 font-pixel sm:h-[78px] sm:w-[110px] ${
                g.locked
                  ? "border-gold bg-[#3a2a08] text-gold"
                  : secondsLeft <= 5
                    ? "border-danger bg-black/75 text-[#ff6b5a]"
                    : "border-white/10 bg-black/75 text-stone"
              }`}
              aria-live="polite"
            >
              <span className="text-2xl leading-none sm:text-3xl">{g.locked ? "✓" : secondsLeft}</span>
              <span className="mt-1 text-[9px] font-normal text-ash">{g.locked ? "TERKUNCI" : "KUNCI OTOMATIS"}</span>
            </div>
          </div>
        </div>
      )}

      {/* spectator */}
      {deathShown && phase !== "finished" && phase !== "lobby" && phase !== "countdown" && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-6 flex flex-col items-center gap-2 px-4">
          <div className="panel px-4 py-2 text-center font-pixel text-danger">KAMU TERELIMINASI</div>
          <div className="text-xs text-ash">Kamu tetap menonton sampai game selesai.</div>
          <Link href="/" className="btn-stone px-4 py-2 text-sm" onClick={() => useGame.getState().leave()}>
            Keluar
          </Link>
        </div>
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => {
            setSettingsOpen(false);
            useView.getState().relock();
          }}
        />
      )}

      {confirmOpen && pendingSkill && (
        <SkillConfirmModal
          skill={pendingSkill}
          bid={bid}
          budget={budget}
          onConfirm={confirmSkill}
          onCancel={cancelSkill}
        />
      )}

      {phase === "finished" && g.end && meNum !== null && <ResultModal />}
    </div>
  );
}
