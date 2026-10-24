/**
 * @dorprize/game-core — shared by the web app and the backend.
 *
 * - protocol: Socket.io event payloads (the client/server contract)
 * - rules:    timings, skills, board sizing
 * - geometry: grid helpers (directions, rings, arena shrink)
 * - engine:   round resolver (runs in RoomRunner)
 * - skins:    skin ids and palettes
 * - bots:     simple bot player (mock + server test rooms)
 * - room:     RoomRunner — one room's full lifecycle (browser mock + server)
 * - auth:     wallet login message (frontend signs, backend verifies)
 */
export * from "./engine";
export * from "./geometry";
export * from "./protocol";
export * from "./rules";
export * from "./skins";
export * from "./bots";
export * from "./room";
export * from "./auth";
