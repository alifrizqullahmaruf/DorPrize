"use client";

import { keccak256, parseUnits, toHex, type Hex } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { readContract, waitForTransactionReceipt } from "@wagmi/core";
import { backendFetch } from "@/shared/backend/api";
import { loginHeaders } from "@/shared/lib/walletLogin";
import { wagmiAdapter } from "@/features/wallet/web3/appKit";
import {
  ROOM_MANAGER_ABI,
  ROOM_MANAGER_ADDRESS,
  USDC_DECIMALS,
  hasRoomContractConfig,
} from "@/features/wallet/web3/contracts";
import { IS_DEMO } from "@/features/wallet/account";
import { useProfile } from "@/features/wallet/profile";

/**
 * Lock bids in RoomManager on join. Off (default) until the backend issues
 * join tickets: players then play together while the wallet (faucet, deposit,
 * withdraw) still runs on-chain.
 */
export const BIDS_ON_CHAIN = process.env.NEXT_PUBLIC_ONCHAIN_BIDS === "1";

/** Whether joining a room actually locks the bid (simulated balance in demo mode). */
export const BIDS_LOCKED = IS_DEMO || BIDS_ON_CHAIN;

export type JoinRoomTx = {
  /** Lock the bid for `roomId`. Resolves true when the player may ready up. */
  lockBid: (roomId: string, bid: number) => Promise<boolean>;
  /** Give the bid back when leaving before the game starts. */
  releaseBid: (roomId: string, bid: number) => Promise<void>;
  /** Forfeit the bid (left mid-game) — the pot keeps it. */
  forfeitBid: (bid: number, fees: number) => void;
};

function useDemoJoin(): JoinRoomTx {
  const lock = useProfile((s) => s.demoLock);
  const unlock = useProfile((s) => s.demoUnlock);
  const settle = useProfile((s) => s.demoSettle);
  return {
    lockBid: async (_roomId, bid) => {
      if (useProfile.getState().demoAvailable < bid) return false;
      lock(bid);
      return true;
    },
    releaseBid: async (_roomId, bid) => unlock(bid),
    forfeitBid: (bid, fees) => settle(bid, 0, fees),
  };
}

/** Response of `POST /rooms/:id/ticket`: a backend-signed EIP-712 JoinTicket. */
type JoinTicket = {
  /** Bid in USDC base units (6 decimals), as a decimal string. */
  bid: string;
  maxPlayers: number;
  /** Unix seconds. */
  deadline: number;
  signature: Hex;
};

/** Backend room ids are strings; the contract takes bytes32 (= keccak256 of the id). */
export function roomIdToBytes32(roomId: string): Hex {
  return keccak256(toHex(roomId));
}

function useChainJoin(): JoinRoomTx {
  const { writeContractAsync } = useWriteContract();
  const { address } = useAccount();
  return {
    lockBid: async (roomId, bid) => {
      // Bids off or contract not deployed yet: nothing to lock on-chain.
      if (!BIDS_ON_CHAIN || !hasRoomContractConfig()) return true;
      // Already locked (e.g. pressing SIAP again after a network error).
      if (address) {
        const joined = await readContract(wagmiAdapter.wagmiConfig, {
          address: ROOM_MANAGER_ADDRESS as Hex,
          abi: ROOM_MANAGER_ABI,
          functionName: "isInRoom",
          args: [roomIdToBytes32(roomId), address],
        });
        if (joined) return true;
      }
      // The backend checks room access (public / QR) and capacity, then signs an EIP-712
      // JoinTicket(roomId, player, bid, maxPlayers, deadline) for RoomManager.joinRoom.
      const ticket = await backendFetch<JoinTicket>(`/rooms/${roomId}/ticket`, {
        method: "POST",
        headers: loginHeaders(),
      });
      const bidUnits = BigInt(ticket.bid);
      if (bidUnits !== parseUnits(String(bid), USDC_DECIMALS)) throw new Error("Bid room berubah. Muat ulang room.");
      const hash = await writeContractAsync({
        address: ROOM_MANAGER_ADDRESS as Hex,
        abi: ROOM_MANAGER_ABI,
        functionName: "joinRoom",
        args: [roomIdToBytes32(roomId), bidUnits, ticket.maxPlayers, BigInt(ticket.deadline), ticket.signature],
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      return true;
    },
    releaseBid: async (roomId) => {
      if (!BIDS_ON_CHAIN || !hasRoomContractConfig()) return;
      const hash = await writeContractAsync({
        address: ROOM_MANAGER_ADDRESS as Hex,
        abi: ROOM_MANAGER_ABI,
        functionName: "leaveRoom",
        args: [roomIdToBytes32(roomId)],
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
    },
    forfeitBid: () => {},
  };
}

export const useJoinRoomTx: () => JoinRoomTx = IS_DEMO ? useDemoJoin : useChainJoin;
