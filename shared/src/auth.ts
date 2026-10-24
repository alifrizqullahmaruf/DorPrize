/**
 * Wallet login shared by the frontend (signs) and the backend (verifies).
 * A signed plain-text message travels with every request, so it works across
 * domains without cookies (frontend on Vercel, game server behind a tunnel).
 */
export const LOGIN_TTL_MS = 24 * 60 * 60 * 1000;

export type WalletLogin = {
  address: string;
  /** Epoch ms when the message was signed. */
  issuedAt: number;
  signature: string;
};

export function loginMessage(address: string, issuedAt: number) {
  return `DOR PRIZE login\nAddress: ${address.toLowerCase()}\nIssued at: ${issuedAt}`;
}

/** HTTP header carrying a WalletLogin (base64 JSON). */
export const LOGIN_HEADER = "x-dorprize-login";
