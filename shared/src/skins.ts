/**
 * Original war-themed skins. Pure data: textures are painted from these
 * palettes in frontend/src/features/game/three/textures.ts (no Minecraft/Steve assets).
 */
export type SkinDef = {
  id: string;
  name: string;
  /** Camo palette for jacket: base + 2 blotch colours. */
  jacket: [string, string, string];
  pants: [string, string, string];
  skin: string;
  hair: string;
  boots: string;
  belt: string;
  helmet: "basic" | "desert" | "urban" | "winter" | "jungle" | "tactical";
  extra?: "goggles" | "beard" | "scarf" | "visor" | "mask" | "medic";
};

export const HELMET_COLORS: Record<SkinDef["helmet"], [string, string, string]> = {
  basic: ["#55602f", "#48522a", "#646f3a"],
  desert: ["#c9ad7a", "#b39463", "#dcc394"],
  urban: ["#55585c", "#3f4246", "#6d7075"],
  winter: ["#e4e7ea", "#c9ced3", "#f5f6f7"],
  jungle: ["#3f5a2a", "#2f4520", "#587a3a"],
  tactical: ["#26282b", "#1b1c1e", "#35383c"],
};

export const GOLD_HELMET: [string, string, string] = ["#f5b82e", "#c9851a", "#ffd76a"];

export const SKINS: SkinDef[] = [
  {
    id: "soldier",
    name: "Soldier",
    jacket: ["#56663a", "#3f4d2a", "#7a7a4a"],
    pants: ["#4c5a33", "#3a4526", "#6b6b42"],
    skin: "#c98f65",
    hair: "#3b2a1e",
    boots: "#2b241d",
    belt: "#5a4630",
    helmet: "basic",
  },
  {
    id: "desert",
    name: "Desert Raider",
    jacket: ["#cdb486", "#b0946a", "#e0cfa6"],
    pants: ["#bfa57a", "#a38a60", "#d6c296"],
    skin: "#a8704b",
    hair: "#22170f",
    boots: "#6b4f33",
    belt: "#4a3826",
    helmet: "desert",
    extra: "goggles",
  },
  {
    id: "urban",
    name: "Urban Ops",
    jacket: ["#6e7176", "#4e5156", "#9a9da2"],
    pants: ["#55585d", "#3e4146", "#7b7e83"],
    skin: "#e0b08a",
    hair: "#4a3424",
    boots: "#1e1f22",
    belt: "#2a2b2e",
    helmet: "urban",
    extra: "mask",
  },
  {
    id: "winter",
    name: "Winter Scout",
    jacket: ["#e8ebee", "#c3c9cf", "#9aa3ab"],
    pants: ["#d9dde1", "#b5bcc3", "#8f989f"],
    skin: "#f0c7a4",
    hair: "#7a5a3c",
    boots: "#3a3f45",
    belt: "#5f6870",
    helmet: "winter",
    extra: "goggles",
  },
  {
    id: "jungle",
    name: "Jungle Ranger",
    jacket: ["#3d5a2c", "#2a3f1e", "#6a7f3a"],
    pants: ["#36502a", "#24381b", "#5c7034"],
    skin: "#8d5a3a",
    hair: "#1a120c",
    boots: "#2a2016",
    belt: "#4b3a22",
    helmet: "jungle",
    extra: "beard",
  },
  {
    id: "tactical",
    name: "Tactical",
    jacket: ["#2b2d31", "#1c1d20", "#3d4045"],
    pants: ["#25272a", "#18191b", "#36393d"],
    skin: "#c48a62",
    hair: "#111111",
    boots: "#111111",
    belt: "#3a3a3a",
    helmet: "tactical",
    extra: "visor",
  },
  {
    id: "navy",
    name: "Navy",
    jacket: ["#2c4a7a", "#1f3660", "#3e5f94"],
    pants: ["#253f68", "#1a2f52", "#34517f"],
    skin: "#d9a27a",
    hair: "#2b1d13",
    boots: "#151a22",
    belt: "#d0b060",
    helmet: "tactical",
    extra: "scarf",
  },
  {
    id: "medic",
    name: "Medic",
    jacket: ["#8a8f6a", "#6f7454", "#a3a882"],
    pants: ["#6d7350", "#555a3d", "#868b66"],
    skin: "#e2b48e",
    hair: "#5a3b22",
    boots: "#2d261e",
    belt: "#ece6d6",
    helmet: "basic",
    extra: "medic",
  },
];

export const SKIN_IDS = SKINS.map((s) => s.id);

export function getSkin(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
