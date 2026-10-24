import { parseEther } from "viem";
import { parseSiweMessage } from "viem/siwe";

/** Preserve all 18 decimals and reject input that could silently round or truncate. */
export function parseMon(value: string, allowZero = false) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value))
    throw new Error("Masukkan jumlah MON dengan maksimal 18 desimal.");
  const wei = parseEther(value);
  if (wei < 0n || (!allowZero && wei === 0n)) throw new Error("Jumlah MON harus lebih besar dari nol.");
  return wei;
}

export function validateNativeChallenge(
  challenge: { message: string; expiresAt: number },
  address: string,
  origin: string,
  now = Date.now(),
) {
  const parsed = parseSiweMessage(challenge.message);
  const target = new URL(origin);
  if (
    parsed.address?.toLowerCase() !== address.toLowerCase() ||
    parsed.chainId !== 10143 ||
    parsed.domain !== target.host ||
    parsed.uri !== target.origin ||
    challenge.expiresAt <= now ||
    !parsed.expirationTime ||
    parsed.expirationTime.getTime() <= now
  ) {
    throw new Error("Challenge backend tidak sesuai wallet, jaringan, atau domain halaman ini.");
  }
}
