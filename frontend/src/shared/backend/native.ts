/** Explicit opt-in keeps the existing offline/USDC demonstration available. */
export const NATIVE_MODE =
  process.env.NEXT_PUBLIC_ASSET_MODE === "native" && process.env.NEXT_PUBLIC_DEMO_OFFLINE !== "1";
export const ASSET_SYMBOL = NATIVE_MODE ? "MON" : "USDC";

type NativeSession = { token: string; address: string; expiresAt: number };
let session: NativeSession | null = null;
const storageKey = "dorprize-native-session";

export function getNativeSession(): NativeSession | null {
  if (typeof window === "undefined") return null;
  if (!session) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null") as NativeSession | null;
      if (
        saved &&
        /^[0-9a-f]{64}$/.test(saved.token) &&
        /^0x[0-9a-fA-F]{40}$/.test(saved.address) &&
        saved.expiresAt > Date.now()
      )
        session = saved;
    } catch {
      /* An unavailable browser store does not prevent a new login. */
    }
  }
  if (session && session.expiresAt <= Date.now()) setNativeSession(null);
  return session;
}

export function setNativeSession(value: NativeSession | null) {
  session = value;
  if (typeof window === "undefined") return;
  try {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
    else sessionStorage.removeItem(storageKey);
  } catch {
    /* In-memory sessions work when storage is disabled. */
  }
  window.dispatchEvent(new Event("dorprize:native-session"));
}
