import { getAccount, getPublicClient, writeContract } from "@wagmi/core";
import { nativeDeployments, nativeGameVaultAbi } from "@dorprize/contracts/native";
import { isAddress, type Address, type Hex } from "viem";
import { parseMon } from "./validation";
export { parseMon } from "./validation";
import { wagmiAdapter } from "@/features/wallet/web3/appKit";
import { backendFetch, backendPost } from "@/shared/backend/api";
import { getNativeSession } from "@/shared/backend/native";

export const NATIVE_VAULT = (process.env.NEXT_PUBLIC_NATIVE_GAME_VAULT_ADDRESS ||
  nativeDeployments[10143]?.NativeGameVault ||
  "") as Address;
export const hasNativeVault = isAddress(NATIVE_VAULT) && !/^0x0{40}$/i.test(NATIVE_VAULT);

export function nativeClient() {
  const client = getPublicClient(wagmiAdapter.wagmiConfig, { chainId: 10143 });
  if (!client || !hasNativeVault) throw new Error("Konfigurasi kontrak MON native belum tersedia.");
  return client;
}

export function nativePlayer() {
  const wallet = getAccount(wagmiAdapter.wagmiConfig);
  const session = getNativeSession();
  if (!wallet.address || wallet.chainId !== 10143) throw new Error("Hubungkan MetaMask ke Monad Testnet.");
  if (!session || session.address.toLowerCase() !== wallet.address.toLowerCase())
    throw new Error("Login game dengan wallet yang terhubung terlebih dahulu.");
  return wallet.address;
}

export async function confirmNativeTransaction(hash: Hex) {
  const client = nativeClient();
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error("Transaksi gagal di jaringan.");
  const until = Date.now() + 30_000;
  while ((await client.getBlock({ blockTag: "finalized" })).number < receipt.blockNumber) {
    if (Date.now() >= until) throw new Error("Finality tertunda. Periksa transaksi sebelum mencoba lagi.");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if ((await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash)
    throw new Error("Receipt transaksi belum canonical.");
  if (typeof window !== "undefined") window.dispatchEvent(new Event("dorprize:native-balance"));
  return receipt;
}

export type NativeRoomInfo = {
  roomId: string;
  escrowRoomId: Hex;
  name: string;
  bidWei: string;
  maxPlayers: number;
  players: number;
  isPrivate: boolean;
  status: string;
  chainId: number;
  vault: Address;
  joinDeadline: string;
};

export async function nativeRoomInfo(code: string) {
  const room = await backendFetch<NativeRoomInfo>(`/rooms/${encodeURIComponent(code)}`);
  if (
    room.chainId !== 10143 ||
    room.vault.toLowerCase() !== NATIVE_VAULT.toLowerCase() ||
    !/^0x[0-9a-fA-F]{64}$/.test(room.escrowRoomId) ||
    BigInt(room.bidWei) < 10n ** 18n
  )
    throw new Error("Konfigurasi room tidak sesuai kontrak testnet.");
  return room;
}

export async function hasNativeEntry(code: string) {
  const account = nativePlayer();
  const room = await nativeRoomInfo(code);
  const entry = await nativeClient().readContract({
    address: NATIVE_VAULT,
    abi: nativeGameVaultAbi,
    functionName: "getEntry",
    args: [room.escrowRoomId, account],
    blockTag: "finalized",
  });
  return { room, entry };
}

/** A ticket reserves exactly the budget the player reviewed in the join screen. */
export async function joinNativeRoom(code: string, budgetText: string) {
  const account = nativePlayer();
  const { room, entry } = await hasNativeEntry(code);
  if (entry.joined) return;
  const budget = parseMon(budgetText, true);
  const response = await backendPost<{
    ticket: { roomId: Hex; player: Address; skillBudgetWei: string; nonce: string; deadline: string };
    signature: Hex;
    chainId: number;
    vault: Address;
  }>(`/rooms/${encodeURIComponent(code)}/ticket`, { skillBudgetWei: budget.toString() });
  const raw = response.ticket;
  if (
    response.chainId !== 10143 ||
    response.vault.toLowerCase() !== NATIVE_VAULT.toLowerCase() ||
    raw.player.toLowerCase() !== account.toLowerCase() ||
    raw.roomId !== room.escrowRoomId ||
    BigInt(raw.skillBudgetWei) !== budget
  )
    throw new Error("Tiket tidak sesuai wallet, room, atau budget yang dipilih.");
  const ticket = { ...raw, skillBudgetWei: budget, nonce: BigInt(raw.nonce), deadline: BigInt(raw.deadline) };
  const request = {
    account,
    address: NATIVE_VAULT,
    abi: nativeGameVaultAbi,
    functionName: "joinRoom" as const,
    args: [ticket, response.signature] as const,
  };
  const client = nativeClient();
  await client.simulateContract(request);
  const gas = await client.estimateContractGas(request);
  const hash = await writeContract(wagmiAdapter.wagmiConfig, { ...request, chainId: 10143, gas });
  await confirmNativeTransaction(hash);
}

export async function leaveNativeRoom(code: string) {
  const account = nativePlayer();
  const { room, entry } = await hasNativeEntry(code);
  if (!entry.joined) return;
  const client = nativeClient();
  const onchain = await client.readContract({
    address: NATIVE_VAULT,
    abi: nativeGameVaultAbi,
    functionName: "getRoom",
    args: [room.escrowRoomId],
    blockTag: "finalized",
  });
  if (onchain.status !== 1) return;
  const request = {
    account,
    address: NATIVE_VAULT,
    abi: nativeGameVaultAbi,
    functionName: "leaveRoom" as const,
    args: [room.escrowRoomId] as const,
  };
  await client.simulateContract(request);
  const gas = await client.estimateContractGas(request);
  await confirmNativeTransaction(await writeContract(wagmiAdapter.wagmiConfig, { ...request, chainId: 10143, gas }));
}
