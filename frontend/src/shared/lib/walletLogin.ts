/**
 * Signed wallet login (see @dorprize/game-core auth). Kept per browser so the
 * player signs once a day; sent in the socket handshake and on REST calls.
 */
import { LOGIN_HEADER, LOGIN_TTL_MS, type WalletLogin } from "@dorprize/game-core";

const KEY = "dorprize.login";
/** Re-sign a little before the server would reject it. */
const MARGIN_MS = 10 * 60 * 1000;

export function readLogin(address?: string): WalletLogin | null {
  try {
    const login = JSON.parse(localStorage.getItem(KEY) || "null") as WalletLogin | null;
    if (!login || Date.now() - login.issuedAt > LOGIN_TTL_MS - MARGIN_MS) return null;
    if (address && login.address.toLowerCase() !== address.toLowerCase()) return null;
    return login;
  } catch {
    return null;
  }
}

export function saveLogin(login: WalletLogin) {
  try {
    localStorage.setItem(KEY, JSON.stringify(login));
  } catch {
    // Storage blocked: the login only lasts for this page.
  }
}

export function loginHeaders(): Record<string, string> {
  const login = readLogin();
  return login ? { [LOGIN_HEADER]: btoa(JSON.stringify(login)) } : {};
}
