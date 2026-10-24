/** Native MON integration entry point. Never import the legacy 6-decimal USDC ABI for this deployment. */
import { encodeAbiParameters, keccak256 } from "viem";
export { nativeGameVaultAbi } from "./abi/NativeGameVault";
export { nativeDeployments, type NativeContractAddresses } from "./abi/nativeDeployments";

export type NativeAddress = `0x${string}`;
export type NativeHex = `0x${string}`;

export const MONAD_TESTNET_CHAIN_ID = 10143;
export const MON_DECIMALS = 18;
export const MON_CENT = 10n ** 16n;

/** Hash the backend's confirmed expected roster, preserving getRoom().players order. */
export function nativeRosterHash(players: readonly NativeAddress[]): NativeHex {
  return keccak256(encodeAbiParameters([{ type: "address[]" }], [players]));
}

export const nativeJoinTicketTypes = {
  JoinTicket: [
    { name: "roomId", type: "bytes32" },
    { name: "player", type: "address" },
    { name: "skillBudgetWei", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export type NativeJoinTicket = {
  roomId: NativeHex;
  player: NativeAddress;
  skillBudgetWei: bigint;
  nonce: bigint;
  deadline: bigint;
};

/** Use with viem signTypedData/hashTypedData. Read nonce from this vault immediately before issuance. */
export function nativeJoinTypedData(vault: NativeAddress, ticket: NativeJoinTicket, chainId = MONAD_TESTNET_CHAIN_ID) {
  return {
    domain: { name: "DorPrizeNativeGameVault", version: "1", chainId, verifyingContract: vault },
    types: nativeJoinTicketTypes,
    primaryType: "JoinTicket" as const,
    message: ticket,
  };
}

export const nativeSkillPercent = { mine: 15n, shotgun: 25n, shield: 25n, helmet: 40n } as const;

/** Integer half-up rounding to 0.01 MON, matching the product's price rule. */
export function nativeSkillPrice(bidWei: bigint, skill: keyof typeof nativeSkillPercent): bigint {
  if (bidWei < 10n ** 18n) throw new RangeError("Minimum bid is 1 MON");
  return ((bidWei * nativeSkillPercent[skill] + 50n * MON_CENT) / (100n * MON_CENT)) * MON_CENT;
}

/** Winners MUST be ordered by frozen roster. Split all wei; earlier winners receive residual 1-wei shares. */
export function nativePayout(bidWei: bigint, playerCount: number, winnerCount: number) {
  if (
    bidWei < 10n ** 18n ||
    !Number.isInteger(playerCount) ||
    playerCount < 2 ||
    playerCount > 10 ||
    !Number.isInteger(winnerCount) ||
    winnerCount < 1 ||
    winnerCount > playerCount
  ) {
    throw new RangeError("Invalid native settlement terms");
  }
  const potWei = bidWei * BigInt(playerCount);
  const payoutEachWei = potWei / BigInt(winnerCount);
  const remainderWei = potWei % BigInt(winnerCount);
  const amountsWei = Array.from(
    { length: winnerCount },
    (_, i) => payoutEachWei + (BigInt(i) < remainderWei ? 1n : 0n),
  );
  return { potWei, payoutEachWei, amountsWei, dustWei: 0n };
}
