/**
 * Stable guest id for this browser, sent to the game server so a player keeps
 * their seat across reloads and reconnects. Replaced by the wallet address once
 * SIWE login is wired in.
 */
const KEY = "dorprize.playerId";

export function getPlayerId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = `guest-${crypto.randomUUID()}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // Storage blocked: a per-tab id still works, it just won't survive a reload.
    return `guest-${crypto.randomUUID()}`;
  }
}
