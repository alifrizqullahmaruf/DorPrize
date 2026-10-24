"use client";

import { useEffect, useRef } from "react";
import { drawSkinFront } from "@/features/game/three/textures";

export function SkinPreview({ skin, scale = 4, className = "" }: { skin: string; scale?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawSkinFront(ref.current, skin);
  }, [skin]);
  return (
    <canvas
      ref={ref}
      width={16}
      height={34}
      className={className}
      style={{ width: 16 * scale, height: 34 * scale, imageRendering: "pixelated" }}
      aria-hidden
    />
  );
}
