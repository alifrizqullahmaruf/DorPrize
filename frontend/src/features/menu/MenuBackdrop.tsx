"use client";

import dynamic from "next/dynamic";

/** The menu's Three.js scene is browser-only: load it without SSR. */
export const MenuBackdrop = dynamic(() => import("@/features/menu/MenuScene"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_60%,#7a2a08,#1a0703_70%)]" />,
});
