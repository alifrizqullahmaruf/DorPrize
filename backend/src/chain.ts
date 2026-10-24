/**
 * On-chain side of a room (RoomManager on Monad testnet):
 * join tickets, startRoom when the game begins, settleRoom when it ends.
 * The server key is both the EIP-712 backendSigner and the relayer (operator).
 */
import { deployments, gameVaultAbi, roomManagerAbi } from "@dorprize/contracts";
import { LOGIN_TTL_MS, loginMessage, type GameEnd, type WalletLogin } from "@dorprize/game-core";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  keccak256,
  parseUnits,
  toHex,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const CHAIN_ID = 10143;
const USDC_DECIMALS = 6;
const TICKET_TTL_S = 10 * 60;
const SETTLE_TTL_S = 60 * 60;

export type SettlementStatus =
  { status: "pending" } | { status: "settled"; txHash: Hex } | { status: "failed"; error: string; txHash?: Hex };

/** Contract room id for a room code (same as the frontend's roomIdToBytes32). */
export const roomKey = (roomId: string): Hex => keccak256(toHex(roomId));

const usdc = (amount: number) => parseUnits(amount.toFixed(USDC_DECIMALS), USDC_DECIMALS);

/** Checks a WalletLogin and returns the lower-cased address, or null. */
export async function verifyLogin(login: unknown, now = Date.now()): Promise<string | null> {
  const l = login as Partial<WalletLogin> | null;
  if (!l || typeof l.address !== "string" || typeof l.signature !== "string" || typeof l.issuedAt !== "number") {
    return null;
  }
  if (!isAddress(l.address) || Math.abs(now - l.issuedAt) > LOGIN_TTL_MS) return null;
  try {
    const ok = await verifyMessage({
      address: l.address,
      message: loginMessage(l.address, l.issuedAt),
      signature: l.signature as Hex,
    });
    return ok ? l.address.toLowerCase() : null;
  } catch {
    return null;
  }
}

export class ChainService {
  readonly account: PrivateKeyAccount;
  readonly roomManager: Address;
  readonly vault: Address;
  private readonly publicClient;
  private readonly walletClient;
  private readonly settlements = new Map<string, SettlementStatus>();
  private readonly domain;

  /** @param contracts Override the committed deployment (local tests). */
  constructor(privateKey: Hex, rpcUrl: string, contracts?: { roomManager: Address; vault: Address }) {
    const d = deployments[CHAIN_ID];
    if (!d && !contracts) throw new Error(`No deployment for chain ${CHAIN_ID} in @dorprize/contracts.`);
    this.roomManager = contracts?.roomManager ?? (d!.RoomManager as Address);
    this.vault = contracts?.vault ?? (d!.GameVault as Address);
    const chain = defineChain({
      id: CHAIN_ID,
      name: "Monad Testnet",
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    this.account = privateKeyToAccount(privateKey);
    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    this.walletClient = createWalletClient({ chain, transport: http(rpcUrl), account: this.account });
    this.domain = { name: "DorPrizeRoomManager", version: "1", chainId: CHAIN_ID, verifyingContract: this.roomManager };
  }

  /** The server key must be the contract's backendSigner and operator. */
  async checkRoles() {
    const [signer, operator, balance] = await Promise.all([
      this.publicClient.readContract({ address: this.roomManager, abi: roomManagerAbi, functionName: "backendSigner" }),
      this.publicClient.readContract({ address: this.roomManager, abi: roomManagerAbi, functionName: "operator" }),
      this.publicClient.getBalance({ address: this.account.address }),
    ]);
    const me = this.account.address.toLowerCase();
    if (signer.toLowerCase() !== me) throw new Error(`Server key ${me} is not RoomManager.backendSigner (${signer}).`);
    if (operator.toLowerCase() !== me) throw new Error(`Server key ${me} is not RoomManager.operator (${operator}).`);
    return { address: this.account.address, balance };
  }

  /** EIP-712 JoinTicket for RoomManager.joinRoom. */
  async ticket(roomId: string, player: string, bid: number, maxPlayers: number) {
    const bidUnits = usdc(bid);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + TICKET_TTL_S);
    const signature = await this.account.signTypedData({
      domain: this.domain,
      primaryType: "JoinTicket",
      types: {
        JoinTicket: [
          { name: "roomId", type: "bytes32" },
          { name: "player", type: "address" },
          { name: "bid", type: "uint256" },
          { name: "maxPlayers", type: "uint8" },
          { name: "deadline", type: "uint64" },
        ],
      },
      message: { roomId: roomKey(roomId), player: player as Address, bid: bidUnits, maxPlayers, deadline },
    });
    return { bid: bidUnits.toString(), maxPlayers, deadline: Number(deadline), signature };
  }

  async isInRoom(roomId: string, player: string) {
    return this.publicClient.readContract({
      address: this.roomManager,
      abi: roomManagerAbi,
      functionName: "isInRoom",
      args: [roomKey(roomId), player as Address],
    });
  }

  async availableOf(player: string) {
    const units = await this.publicClient.readContract({
      address: this.vault,
      abi: gameVaultAbi,
      functionName: "availableBalanceOf",
      args: [player as Address],
    });
    return Number(units) / 10 ** USDC_DECIMALS;
  }

  /** Close the room on-chain (no more leaving) once the game starts. */
  async start(roomId: string) {
    const hash = await this.walletClient.writeContract({
      address: this.roomManager,
      abi: roomManagerAbi,
      functionName: "startRoom",
      args: [roomKey(roomId)],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  settlementOf(roomId: string): SettlementStatus | undefined {
    return this.settlements.get(roomId);
  }

  /**
   * Pay the pot: winners split it, skill fees go to the treasury.
   * `addressOf` maps seat numbers to wallet addresses.
   */
  async settle(roomId: string, end: GameEnd, addressOf: (num: number) => string | undefined) {
    this.settlements.set(roomId, { status: "pending" });
    let hash: Hex | undefined;
    try {
      const room = await this.publicClient.readContract({
        address: this.roomManager,
        abi: roomManagerAbi,
        functionName: "getRoom",
        args: [roomKey(roomId)],
      });
      const players = room[5] as readonly Address[];
      const onChain = new Set(players.map((p) => p.toLowerCase()));
      const winners = end.winners
        .map(addressOf)
        .filter((a): a is string => !!a && onChain.has(a.toLowerCase())) as Address[];
      if (winners.length === 0) throw new Error("No on-chain winner to pay.");

      const feeByAddress = new Map<string, number>();
      for (const [num, fee] of Object.entries(end.skillFees)) {
        const a = addressOf(Number(num));
        if (a) feeByAddress.set(a.toLowerCase(), fee);
      }
      const skillFees = players.map((p) => usdc(feeByAddress.get(p.toLowerCase()) ?? 0));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + SETTLE_TTL_S);
      const signature = await this.account.signTypedData({
        domain: this.domain,
        primaryType: "Settlement",
        types: {
          Settlement: [
            { name: "roomId", type: "bytes32" },
            { name: "winners", type: "address[]" },
            { name: "skillFees", type: "uint256[]" },
            { name: "deadline", type: "uint64" },
          ],
        },
        message: { roomId: roomKey(roomId), winners, skillFees, deadline },
      });

      hash = await this.walletClient.writeContract({
        address: this.roomManager,
        abi: roomManagerAbi,
        functionName: "settleRoom",
        args: [roomKey(roomId), winners, skillFees, deadline, signature],
      });
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("settleRoom reverted.");
      this.settlements.set(roomId, { status: "settled", txHash: hash });
    } catch (e) {
      const error = e instanceof Error ? e.message.split("\n")[0] : String(e);
      this.settlements.set(roomId, { status: "failed", error, txHash: hash });
      throw e;
    }
  }
}
