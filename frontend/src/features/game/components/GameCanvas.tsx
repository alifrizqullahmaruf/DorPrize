"use client";

import dynamic from "next/dynamic";

/** The game's Three.js scene is browser-only: load it without SSR. */
export const GameCanvas = dynamic(() => import("@/features/game/components/GameScene"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-[#1a0703] font-pixel text-ash">
      Memuat arena…
    </div>
  ),
});
