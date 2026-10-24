import type { Skill } from "./protocol";

/** Phase durations in milliseconds (PRD "Aturan umum"). */
export const TIMING = {
  countdownMs: 10_000,
  inputMs: 15_000,
  animationMs: 5_000,
  resultMs: 3_000,
} as const;

/** Submits are still accepted this long after the input deadline (network + clock skew). */
export const SUBMIT_GRACE_MS = 1000;

export const MAX_ROUNDS = 20;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const MIN_BID = 1;

export const DEFAULT_NAME = "Prajurit";
export const NAME_MAX = 16;

/** Round to whole cents. */
export function roundCents(v: number) {
  return Math.round(v * 100) / 100;
}

export type SkillDef = {
  id: Skill;
  name: string;
  category: "attack" | "defense";
  /** Cost as a fraction of the room bid. */
  pct: number;
  /** Cooldown in rounds, counting the round it is used. */
  cooldown: number;
  hotkey: string;
  description: string;
  /** Longer how-it-works points shown in the purchase confirmation. */
  details: string[];
};

export const SKILLS: Record<Skill, SkillDef> = {
  mine: {
    id: "mine",
    name: "Ranjau",
    category: "attack",
    pct: 0.15,
    cooldown: 2,
    hotkey: "1",
    description: "Dipasang di petak yang sedang kamu injak. Meledak jika lawan berhenti di petak itu.",
    details: [
      "Jalan dulu ke petak mana saja, lalu beli: ranjau langsung dipasang di petak yang kamu injak saat itu.",
      "Meledak jika lawan berakhir di petak itu (mulai ronde ini). Kamu sendiri aman di atasnya.",
      "Hanya kamu yang bisa melihat ranjaumu. Kill dari ranjau dihitung untukmu.",
      "Ranjau di petak yang tenggelam ke lava hancur tanpa meledak.",
    ],
  },
  shotgun: {
    id: "shotgun",
    name: "Shotgun",
    category: "attack",
    pct: 0.25,
    cooldown: 3,
    hotkey: "2",
    description: "Tembak 3 arah sekaligus: arah hadap dan ±45°.",
    details: [
      "Menggantikan pistol untuk ronde ini: menembak lurus ke arah bidik plus 45° ke kiri dan ke kanan.",
      "Setiap jalur berhenti di petak terisi pertama. Satu tembakan bisa menumbangkan beberapa lawan.",
      "Dapat 1 kill untuk setiap korban.",
    ],
  },
  shield: {
    id: "shield",
    name: "Tameng",
    category: "defense",
    pct: 0.25,
    cooldown: 3,
    hotkey: "3",
    description: "Bertahan 1 ronde: blokir tembakan dari depan, tapi kamu tidak menembak.",
    details: [
      "Selama ronde ini kamu TIDAK menembak — laser diganti perisai.",
      "Menahan tembakan yang datang dari depan, yaitu arah kamera/crosshair saat waktu habis.",
      "Tidak melindungi dari samping, belakang, ranjau, atau lawan yang berdiri di petak yang sama.",
    ],
  },
  goldHelm: {
    id: "goldHelm",
    name: "Helm Emas",
    category: "defense",
    pct: 0.4,
    cooldown: 4,
    hotkey: "4",
    description: "Menyerap 1 serangan apa pun. Bertahan sampai kena.",
    details: [
      "Menyerap 1 serangan apa saja: tembakan dari arah mana pun atau ranjau. Tembakannya tetap kena, tapi helm yang jatuh.",
      "Sekali pakai: tetap terpasang di ronde-ronde berikutnya sampai terkena, lalu jatuh dan hilang.",
      "Setelah jatuh, beli lagi setelah cooldown habis. Kalau terkena 2 tembakan di ronde yang sama, kamu tetap tumbang.",
    ],
  },
};

export const SKILL_ORDER: Skill[] = ["mine", "shotgun", "shield", "goldHelm"];

export function skillCost(skill: Skill, bid: number) {
  return roundCents(SKILLS[skill].pct * bid);
}

/**
 * Starting board size follows the number of players in the game:
 * 2–3 → 8×8, 4–6 → 10×10, 7–10 → 12×12. It then shrinks one ring per round to 2×2.
 */
export function boardSizeFor(players: number) {
  if (players <= 3) return 8;
  if (players <= 6) return 10;
  return 12;
}

export function formatUsdc(value: number) {
  return value.toLocaleString("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
