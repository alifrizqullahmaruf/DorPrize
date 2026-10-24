"use client";

import { useEffect } from "react";
import { formatUsdc, skillCost, SKILLS } from "@dorprize/game-core";
import type { Skill } from "@dorprize/game-core";
import { IS_DEMO } from "@/features/wallet/account";
import { SkillIcon, UsdcIcon } from "@/shared/ui/icons";

type Props = {
  skill: Skill;
  bid: number;
  /** Balance still available for skills (available minus skills already bought). */
  budget: number;
  onConfirm: () => void;
  onCancel: () => void;
};

/** "Buy this skill with your wallet balance?" — explains the skill and the charge. */
export function SkillConfirmModal({ skill, bid, budget, onConfirm, onCancel }: Props) {
  const def = SKILLS[skill];
  const cost = skillCost(skill, bid);
  const after = budget - cost;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCancel();
      }
    };
    // Capture phase so the game's own Enter/Space handlers don't also fire.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onConfirm, onCancel]);

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3 safe-inset sm:p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-title"
        className="anim-pop max-h-[92dvh] w-full max-w-sm overflow-y-auto panel p-3.5 sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border-2 border-gold/60 bg-[#2a1f06] sm:size-14">
            <SkillIcon skill={skill} size={30} />
          </div>
          <div className="min-w-0">
            <div className="font-pixel text-[9px] text-ash uppercase sm:text-[10px]">
              Skill {def.category === "attack" ? "serangan" : "pertahanan"} · tombol {def.hotkey}
            </div>
            <h2 id="skill-title" className="font-pixel text-lg text-gold sm:text-xl">
              {def.name}
            </h2>
          </div>
        </div>

        <p className="mt-2.5 text-xs text-stone sm:mt-3 sm:text-sm">{def.description}</p>
        <ul className="mt-1.5 space-y-1 text-[11px] text-ash sm:mt-2 sm:space-y-1.5 sm:text-xs">
          {def.details.map((d) => (
            <li key={d} className="flex gap-2">
              <span className="mt-1 size-1.5 shrink-0 bg-gold" />
              <span>{d}</span>
            </li>
          ))}
          <li className="flex gap-2">
            <span className="mt-1 size-1.5 shrink-0 bg-gold" />
            <span>Cooldown {def.cooldown} ronde (termasuk ronde ini). Maksimal 1 skill per ronde.</span>
          </li>
        </ul>

        <div className="mt-3 rounded-lg border-2 border-white/10 bg-black/40 p-2.5 sm:mt-4 sm:p-3">
          <div className="flex items-center justify-between text-xs sm:text-sm">
            <span className="text-ash">
              Harga ({Math.round(def.pct * 100)}% dari bid {formatUsdc(bid)})
            </span>
            <span className="flex items-center gap-1 font-pixel text-gold">
              <UsdcIcon size={14} />
              {formatUsdc(cost)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-ash sm:text-xs">
            <span>Saldo tersedia</span>
            <span className="font-pixel text-stone">{formatUsdc(budget)} USDC</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[11px] text-ash sm:mt-1 sm:text-xs">
            <span>Saldo setelah beli</span>
            <span className={`font-pixel ${after < 0 ? "text-danger" : "text-stone"}`}>{formatUsdc(after)} USDC</span>
          </div>
        </div>

        <p className="mt-2.5 text-[10px] leading-snug text-ash sm:mt-3 sm:text-[11px]">
          {IS_DEMO
            ? "Biaya akan diambil dari saldo dompetmu (mode demo). "
            : "Biaya akan diambil dari saldo wallet-mu di GameVault saat settlement akhir game. "}
          Biaya skill masuk ke treasury, bukan ke pot, dan tidak dikembalikan meskipun kamu kalah.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4">
          <button type="button" onClick={onCancel} className="btn-stone py-2 text-xs sm:py-3 sm:text-sm">
            TIDAK <span className="text-[10px] opacity-60">(Esc)</span>
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={after < 0}
            className="btn-gold py-2 text-xs sm:py-3 sm:text-sm"
            autoFocus
          >
            YA, BELI <span className="text-[10px] opacity-60">(Enter)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
