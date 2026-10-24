"use client";

import { useState } from "react";
import { useWallet } from "@/features/wallet/web3/WalletProvider";
import { useOnchainDepositFlow } from "@/features/wallet/deposit/useOnchainDepositFlow";
import { formatUsdc } from "@dorprize/game-core";
import { useProfile } from "@/features/wallet/profile";
import { NATIVE_MODE } from "@/shared/backend/native";
import { useNativeAccount } from "@/features/wallet/native/useNativeAccount";

/**
 * DEMO mode keeps balances in the browser (no wallet, no RPC). It is on when
 * NEXT_PUBLIC_DEMO_OFFLINE=1 or no Reown project id is configured, so the
 * game can always be shown even if Monad RPC or the backend is down.
 */
export const IS_DEMO =
  process.env.NEXT_PUBLIC_DEMO_OFFLINE === "1" || (!NATIVE_MODE && !process.env.NEXT_PUBLIC_REOWN_PROJECT_ID);

export const DEMO_FAUCET_AMOUNT = 100;

export type AccountView = {
  mode: "demo" | "chain";
  connected: boolean;
  address: string;
  available: number;
  locked: number;
  skillBudget?: number;
  availableDisplay: string;
  lockedDisplay: string;
  walletDisplay: string;
  amount: string;
  setAmount: (v: string) => void;
  onFaucet: () => Promise<void>;
  onDeposit: () => Promise<void>;
  onWithdraw: () => Promise<void>;
  busy: "" | "faucet" | "deposit" | "withdraw" | "connect";
  status: string;
  error: string;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  needsChainSwitch: boolean;
  switchChain: () => Promise<void>;
};

export function shortAddress(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function toNumber(display: string) {
  const n = Number(String(display).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function useDemoAccount(): AccountView {
  const p = useProfile();
  const [amount, setAmount] = useState("10");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0;
  return {
    mode: "demo",
    connected: true,
    address: "0xDEMO000000000000000000000000000000000D0R",
    available: p.demoAvailable,
    locked: p.demoLocked,
    availableDisplay: formatUsdc(p.demoAvailable),
    lockedDisplay: formatUsdc(p.demoLocked),
    walletDisplay: "∞",
    amount,
    setAmount,
    busy: "",
    status,
    error,
    onFaucet: async () => {
      p.demoFaucet(DEMO_FAUCET_AMOUNT);
      setError("");
      setStatus(`Faucet: +${DEMO_FAUCET_AMOUNT} USDC testnet masuk ke saldo.`);
    },
    onDeposit: async () => {
      if (!valid) return setError("Masukkan jumlah USDC yang valid.");
      p.demoDeposit(parsed);
      setError("");
      setStatus(`Deposit ${formatUsdc(parsed)} USDC berhasil.`);
    },
    onWithdraw: async () => {
      if (!valid) return setError("Masukkan jumlah USDC yang valid.");
      if (p.demoLocked > 0) return setError("Tarik diblokir selama kamu punya room aktif.");
      if (parsed > p.demoAvailable) return setError("Saldo tidak cukup.");
      p.demoWithdraw(parsed);
      setError("");
      setStatus(`Tarik ${formatUsdc(parsed)} USDC berhasil.`);
    },
    connect: async () => {},
    disconnect: async () => {},
    needsChainSwitch: false,
    switchChain: async () => {},
  };
}

function useChainAccount(): AccountView {
  const w = useWallet();
  const vm = useOnchainDepositFlow();
  const busy = vm.isFaucetBusy
    ? "faucet"
    : vm.isDepositBusy || vm.isApproveBusy
      ? "deposit"
      : vm.isWithdrawBusy
        ? "withdraw"
        : w.isConnecting
          ? "connect"
          : "";
  return {
    mode: "chain",
    connected: Boolean(w.account),
    address: w.account,
    available: toNumber(vm.availableBalanceDisplay),
    locked: toNumber(vm.lockedBalanceDisplay),
    availableDisplay: vm.availableBalanceDisplay,
    lockedDisplay: vm.lockedBalanceDisplay,
    walletDisplay: vm.walletBalanceDisplay,
    amount: vm.amount,
    setAmount: vm.setAmount,
    onFaucet: vm.onClaimFaucet,
    onDeposit: vm.onDeposit,
    onWithdraw: async () => {
      if (toNumber(vm.lockedBalanceDisplay) > 0) return;
      await vm.onWithdraw();
    },
    busy,
    status: vm.statusMessage,
    error: vm.errorMessage || w.error || w.backendAuthError,
    connect: w.connectWallet,
    disconnect: w.disconnectWallet,
    needsChainSwitch: Boolean(w.account) && !w.isMonadChain,
    switchChain: w.switchToMonad,
  };
}

export const useAccountView: () => AccountView = IS_DEMO
  ? useDemoAccount
  : NATIVE_MODE
    ? useNativeAccount
    : useChainAccount;
