import { deployments, gameUsdcAbi, gameVaultAbi, roomManagerAbi, usdcFaucetAbi } from "@dorprize/contracts";
import { isAddress } from "viem";

export const USDC_DECIMALS = 6;

/** Monad testnet. Addresses fall back to the committed deployment for this chain. */
const MONAD_TESTNET_ID = 10143;
const deployed = deployments[MONAD_TESTNET_ID];

export const USDC_ADDRESS: string = process.env.NEXT_PUBLIC_USDC_ADDRESS || deployed?.GameUSDC || "";
export const USDC_FAUCET_ADDRESS: string = process.env.NEXT_PUBLIC_USDC_FAUCET_ADDRESS || deployed?.USDCFaucet || "";
export const GAME_VAULT_ADDRESS: string = process.env.NEXT_PUBLIC_GAME_VAULT_ADDRESS || deployed?.GameVault || "";
export const ROOM_MANAGER_ADDRESS: string = process.env.NEXT_PUBLIC_ROOM_MANAGER_ADDRESS || deployed?.RoomManager || "";

// ABIs are generated from the Foundry build (sc, `npm run sc:abi`).
export const ERC20_ABI = gameUsdcAbi;
export const GAME_VAULT_ABI = gameVaultAbi;
export const USDC_FAUCET_ABI = usdcFaucetAbi;
export const ROOM_MANAGER_ABI = roomManagerAbi;

export function hasDepositContractConfig() {
  return Boolean(isAddress(USDC_ADDRESS) && isAddress(USDC_FAUCET_ADDRESS) && isAddress(GAME_VAULT_ADDRESS));
}

export function hasRoomContractConfig() {
  return Boolean(isAddress(GAME_VAULT_ADDRESS) && isAddress(ROOM_MANAGER_ADDRESS));
}
