import { getAddress, isAddress, type Address, type Hex } from "viem";

export type NativeConfig = {
  chainId: 10143 | 31337;
  rpcUrl: string;
  vault: Address;
  operatorKey: Hex;
  signerKey: Hex;
  authOrigin: string;
  databaseUrl?: string;
  stateDirectory?: string;
  workerIntervalMs: number;
};

export function loadNativeConfig(env: NodeJS.ProcessEnv = process.env): NativeConfig {
  const chainId = Number(env.CHAIN_ID ?? 10143);
  const rpcUrl = env.MONAD_RPC_URL ?? "";
  const rpc = new URL(rpcUrl);
  if (!["http:", "https:"].includes(rpc.protocol)) throw new Error("RPC must use HTTP(S)");
  if (
    chainId !== 10143 &&
    !(chainId === 31337 && env.NATIVE_ALLOW_LOCAL === "1" && ["localhost", "127.0.0.1"].includes(rpc.hostname))
  )
    throw new Error("Only Monad testnet or explicit localhost allowed");
  const vault = env.NATIVE_GAME_VAULT_ADDRESS ?? "";
  if (!isAddress(vault) || /^0x0{40}$/i.test(vault)) throw new Error("NATIVE_GAME_VAULT_ADDRESS required");
  const key = (name: string): Hex => {
    const value = env[name] ?? "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be configured in server secrets`);
    return value as Hex;
  };
  const origin = new URL(env.AUTH_ORIGIN ?? "https://dorprize.vercel.app");
  if (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname))
    throw new Error("AUTH_ORIGIN requires HTTPS");
  if (!env.DATABASE_URL && !env.NATIVE_STATE_DIR)
    throw new Error("DATABASE_URL or NATIVE_STATE_DIR required for durable results");
  return {
    chainId,
    rpcUrl,
    vault: getAddress(vault),
    operatorKey: key("OPERATOR_PRIVATE_KEY"),
    signerKey: key("BACKEND_SIGNER_PRIVATE_KEY"),
    authOrigin: origin.origin,
    databaseUrl: env.DATABASE_URL,
    stateDirectory: env.NATIVE_STATE_DIR,
    workerIntervalMs: 5000,
  };
}
