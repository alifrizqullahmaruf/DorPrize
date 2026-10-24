import type { Skill } from "@dorprize/game-core";

/** 12×12 pixel-art icons drawn with rects (crisp at any size). */
const ICONS: Record<Skill, [number, number, number, number, string][]> = {
  mine: [
    [2, 6, 8, 3, "#4f5d2a"],
    [3, 5, 6, 1, "#5f6e33"],
    [1, 8, 10, 2, "#3e4a20"],
    [5, 3, 2, 2, "#d93a2b"],
    [5, 3, 1, 1, "#ff8a7a"],
  ],
  shotgun: [
    [0, 5, 9, 2, "#2b2b2b"],
    [9, 5, 3, 2, "#6b4428"],
    [3, 7, 3, 1, "#6b4428"],
    [7, 7, 2, 2, "#6b4428"],
    [0, 4, 1, 1, "#ff5a1a"],
    [0, 7, 1, 1, "#ff5a1a"],
  ],
  shield: [
    [2, 1, 8, 10, "#8a8a8a"],
    [3, 2, 6, 8, "#7a4f2a"],
    [3, 5, 6, 1, "#5e3c20"],
    [5, 2, 2, 8, "#8e5d33"],
  ],
  goldHelm: [
    [2, 3, 8, 5, "#f5b82e"],
    [1, 7, 10, 2, "#c9851a"],
    [3, 2, 6, 1, "#ffd76a"],
    [4, 4, 2, 1, "#fff3b0"],
    [2, 9, 1, 2, "#6b4a10"],
    [9, 9, 1, 2, "#6b4a10"],
  ],
};

export function SkillIcon({ skill, size = 28 }: { skill: Skill; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden>
      {ICONS[skill].map(([x, y, w, h, c], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={c} />
      ))}
    </svg>
  );
}

export function TrophyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden>
      <rect x="3" y="1" width="6" height="5" fill="#f5b82e" />
      <rect x="1" y="2" width="2" height="2" fill="#c9851a" />
      <rect x="9" y="2" width="2" height="2" fill="#c9851a" />
      <rect x="5" y="6" width="2" height="3" fill="#c9851a" />
      <rect x="3" y="9" width="6" height="2" fill="#9a5a12" />
      <rect x="4" y="2" width="1" height="2" fill="#fff3b0" />
    </svg>
  );
}

export function CrownIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden>
      <rect x="1" y="4" width="2" height="5" fill="#f5b82e" />
      <rect x="5" y="2" width="2" height="7" fill="#f5b82e" />
      <rect x="9" y="4" width="2" height="5" fill="#f5b82e" />
      <rect x="1" y="7" width="10" height="3" fill="#c9851a" />
      <rect x="5" y="8" width="2" height="1" fill="#d93a2b" />
    </svg>
  );
}

export function UsdcIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden>
      <rect x="3" y="1" width="6" height="10" fill="#2775ca" />
      <rect x="1" y="3" width="10" height="6" fill="#2775ca" />
      <rect x="2" y="2" width="8" height="8" fill="#2775ca" />
      <rect x="5" y="3" width="2" height="6" fill="#fff" />
      <rect x="4" y="4" width="4" height="1" fill="#fff" />
      <rect x="4" y="7" width="4" height="1" fill="#fff" />
    </svg>
  );
}
