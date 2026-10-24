export type ServerConfig = {
  port: number;
  /** Browser origins allowed to connect (comma-separated in CORS_ORIGINS). */
  corsOrigins: string[];
  /** Fill rooms with bots (local solo testing only). */
  allowBots: boolean;
  botsPerRoom: number;
  /** Phase-duration multiplier; 1 = PRD timings. Must match the client's animation speed. */
  timeScale: number;
  /** Lobbies nobody is in are dropped after this long. */
  idleLobbyTtlMs: number;
  /** A running game with no connected human is dropped after this long. */
  idleGameTtlMs: number;
  /** How often stale rooms are swept. */
  sweepIntervalMs: number;
  /** On-chain bids: players log in with their wallet and bids are locked in RoomManager. */
  onchain: boolean;
  /** Foundry keystore of the server key (RoomManager backendSigner + operator). */
  signerKeystore: string;
  rpcUrl: string;
};

function num(value: string | undefined, fallback: number) {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const allowBots = env.ALLOW_BOTS === "1" || env.ALLOW_BOTS === "true";
  return {
    port: num(env.PORT, 3001),
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:3000")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    allowBots,
    botsPerRoom: allowBots ? Math.max(0, Math.min(9, num(env.BOTS_PER_ROOM, 3))) : 0,
    timeScale: Math.max(0.01, num(env.TIME_SCALE, 1)),
    idleLobbyTtlMs: num(env.IDLE_LOBBY_TTL_MS, 10 * 60_000),
    idleGameTtlMs: num(env.IDLE_GAME_TTL_MS, 2 * 60_000),
    sweepIntervalMs: num(env.SWEEP_INTERVAL_MS, 60_000),
    onchain: env.ONCHAIN === "1" || env.ONCHAIN === "true",
    signerKeystore: env.SIGNER_KEYSTORE ?? "",
    rpcUrl: env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz",
  };
}
