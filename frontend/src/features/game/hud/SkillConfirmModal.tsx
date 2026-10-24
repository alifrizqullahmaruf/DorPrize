"use client";

import { useEffect } from "react";
import { ASSET_SYMBOL } from "@/shared/backend/native";
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
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-title"
        className="anim-pop max-h-[92dvh] w-full max-w-sm overflow-y-auto panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-lg border-2 border-gold/60 bg-[#2a1f06]">
            <SkillIcon skill={skill} size={40} />
          </div>
          <div className="min-w-0">
            <div className="font-pixel text-[10px] text-ash uppercase">
              Skill {def.category === "attack" ? "serangan" : "pertahanan"} · tombol {def.hotkey}
            </div>
            <h2 id="skill-title" className="font-pixel text-xl text-gold">
              {def.name}
            </h2>
          </div>
        </div>

        <p className="mt-3 text-sm text-stone">{def.description}</p>
        <ul className="mt-2 space-y-1.5 text-xs text-ash">
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

        <div className="mt-4 rounded-lg border-2 border-white/10 bg-black/40 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ash">
              Harga ({Math.round(def.pct * 100)}% dari bid {formatUsdc(bid)})
            </span>
            <span className="flex items-center gap-1 font-pixel text-gold">
              <UsdcIcon size={14} />
              {formatUsdc(cost)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-ash">
            <span>Saldo tersedia</span>
            <span className="font-pixel text-stone">
              {formatUsdc(budget)} {ASSET_SYMBOL}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-ash">
            <span>Saldo setelah beli</span>
            <span className={`font-pixel ${after < 0 ? "text-danger" : "text-stone"}`}>
              {formatUsdc(after)} {ASSET_SYMBOL}
            </span>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-snug text-ash">
          {IS_DEMO
            ? "Biaya akan diambil dari saldo dompetmu (mode demo). "
            : "Biaya akan diambil dari saldo wallet-mu di GameVault saat settlement akhir game. "}
          Biaya skill masuk ke treasury, bukan ke pot, dan tidak dikembalikan meskipun kamu kalah. Kamu masih bisa
          membatalkan pilihan ini sebelum waktu ronde habis.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onCancel} className="btn-stone py-3 text-sm">
            TIDAK <span className="text-[10px] opacity-60">(Esc)</span>
          </button>
          <button type="button" onClick={onConfirm} disabled={after < 0} className="btn-gold py-3 text-sm" autoFocus>
            YA, BELI <span className="text-[10px] opacity-60">(Enter)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
