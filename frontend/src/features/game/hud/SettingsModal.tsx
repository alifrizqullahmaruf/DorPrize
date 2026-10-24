"use client";

import { useEffect, useState } from "react";
import { isMuted, setMuted } from "@/shared/audio/sfx";
import { SENS_MAX, SENS_MIN, useView } from "@/features/game/state/view";

/** In-game settings: mouse/touch look sensitivity and sound. */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const sensitivity = useView((s) => s.sensitivity);
  const setSensitivity = useView((s) => s.setSensitivity);
  const [muted, setMutedState] = useState(isMuted);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3 safe-inset sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="anim-pop max-h-[92dvh] w-full max-w-sm overflow-y-auto panel p-3.5 sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="settings-title" className="font-pixel text-lg text-gold sm:text-xl">
            PENGATURAN
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-stone px-2 py-0.5 text-xs sm:px-2.5 sm:py-1 sm:text-sm"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        <label className="mt-3 block sm:mt-4">
          <div className="flex items-center justify-between text-xs sm:text-sm">
            <span className="text-stone">Sensitivitas mouse / bidik</span>
            <span className="font-pixel text-gold">{sensitivity.toFixed(1)}×</span>
          </div>
          <input
            type="range"
            min={SENS_MIN}
            max={SENS_MAX}
            step={0.1}
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
            className="mt-1.5 w-full accent-[#f5b82e] sm:mt-2"
          />
          <div className="flex justify-between text-[10px] text-ash">
            <span>Lambat</span>
            <button type="button" onClick={() => setSensitivity(1)} className="underline">
              Default
            </button>
            <span>Cepat</span>
          </div>
        </label>

        <label className="mt-3 flex items-center justify-between text-xs sm:mt-4 sm:text-sm">
          <span className="text-stone">Suara</span>
          <input
            type="checkbox"
            checked={!muted}
            onChange={(e) => {
              setMuted(!e.target.checked);
              setMutedState(!e.target.checked);
            }}
            className="size-4 accent-[#f5b82e] sm:size-5"
          />
        </label>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full btn-gold py-2 text-sm sm:mt-5 sm:py-2.5 sm:text-base"
        >
          SELESAI
        </button>
        <p className="mt-1.5 text-center text-[10px] text-ash sm:mt-2 sm:text-[11px]">
          Setelah menutup, klik layar untuk mengendalikan kamera lagi.
        </p>
      </div>
    </div>
  );
}
