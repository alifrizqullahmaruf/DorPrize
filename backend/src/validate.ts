/**
 * Everything coming from a client is untrusted: shape-check it before it
 * reaches the RoomRunner. The engine itself re-validates game rules
 * (solid tiles, cooldowns, one skill per round).
 */
import { DEFAULT_NAME, DIRS, MAX_PLAYERS, MIN_BID, MIN_PLAYERS, NAME_MAX, SKILL_ORDER } from "@dorprize/game-core";
import type { CreateRoomInput, Dir, RoundSubmit, Skill, Tile } from "@dorprize/game-core";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Guest ids from the browser (later: wallet addresses). */
export function parsePlayerId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_:.-]{8,80}$/.test(v) ? v : null;
}

export function parseName(v: unknown): string {
  return str(v, NAME_MAX) || DEFAULT_NAME;
}

export function parseRoomId(v: unknown): string | null {
  const id = str(v, 16).toUpperCase();
  return /^[A-Z0-9]{4,16}$/.test(id) ? id : null;
}

export function parseJoin(v: unknown): { roomId: string; name: string; skin: string } | null {
  if (!isObj(v)) return null;
  const roomId = parseRoomId(v.roomId);
  if (!roomId) return null;
  return { roomId, name: parseName(v.name), skin: str(v.skin, 32) };
}

export function parseCreateRoom(v: unknown): CreateRoomInput | string {
  if (!isObj(v)) return "Body harus JSON.";
  const bid = Number(v.bid);
  const maxPlayers = Number(v.maxPlayers);
  if (!Number.isFinite(bid) || bid < MIN_BID || bid > 1_000_000) return `Bid minimal ${MIN_BID} USDC.`;
  if (!Number.isInteger(maxPlayers) || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
    return `Pemain harus ${MIN_PLAYERS}–${MAX_PLAYERS}.`;
  }
  return {
    name: str(v.name, 24) || "Room",
    bid: Math.round(bid * 1e6) / 1e6,
    maxPlayers,
    isPrivate: v.isPrivate === true,
  };
}

function parseTile(v: unknown): Tile | null | undefined {
  if (v === null || v === undefined) return null;
  if (!isObj(v) || !Number.isInteger(v.x) || !Number.isInteger(v.y)) return undefined;
  return { x: v.x as number, y: v.y as number };
}

function parseDir(v: unknown): Dir | null | undefined {
  if (v === null || v === undefined) return null;
  return DIRS.includes(v as Dir) ? (v as Dir) : undefined;
}

export function parseSubmit(v: unknown): RoundSubmit | null {
  if (!isObj(v)) return null;
  const moveTo = parseTile(v.moveTo);
  const mineAt = parseTile(v.mineAt);
  const shootDir = parseDir(v.shootDir);
  const skill =
    v.skill === null || v.skill === undefined ? null : SKILL_ORDER.includes(v.skill as Skill) ? v.skill : undefined;
  if (moveTo === undefined || mineAt === undefined || shootDir === undefined || skill === undefined) return null;
  return { moveTo, shootDir, skill: skill as Skill | null, mineAt };
}
