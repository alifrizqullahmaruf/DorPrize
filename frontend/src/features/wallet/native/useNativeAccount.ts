"use client";

import { useEffect, useState } from "react";
import { useBalance, useReadContracts, useWriteContract } from "wagmi";
import { nativeGameVaultAbi } from "@dorprize/contracts/native";
import { encodeFunctionData, formatEther, type Address } from "viem";
import { useWallet } from "@/features/wallet/web3/WalletProvider";
import { confirmNativeTransaction, hasNativeVault, nativeClient, NATIVE_VAULT, parseMon } from "./transactions";
import type { AccountView } from "@/features/wallet/account";

export function useNativeAccount(): AccountView {
  const wallet = useWallet();
  const address = wallet.account as Address | undefined;
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState<AccountView["busy"]>("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const { writeContractAsync } = useWriteContract();
  const balance = useBalance({
    address: address || undefined,
    chainId: 10143,
    query: { enabled: Boolean(address), refetchInterval: 5_000 },
  });
  const reads = useReadContracts({
    allowFailure: false,
    contracts: (["availableBalanceOf", "lockedBalanceOf", "skillReservedOf"] as const).map((functionName) => ({
      address: NATIVE_VAULT,
      abi: nativeGameVaultAbi,
      functionName,
      args: [address!] as const,
      chainId: 10143,
    })),
    query: { enabled: Boolean(address) && hasNativeVault, refetchInterval: 3_000 },
  });
  const available = (reads.data?.[0] ?? 0n) as bigint;
  const bidLocked = (reads.data?.[1] ?? 0n) as bigint;
  const skillReserved = (reads.data?.[2] ?? 0n) as bigint;
  const refetchVault = reads.refetch;
  const refetchWallet = balance.refetch;
  useEffect(() => {
    const refresh = () => {
      void refetchVault();
      void refetchWallet();
    };
    window.addEventListener("dorprize:native-balance", refresh);
    return () => window.removeEventListener("dorprize:native-balance", refresh);
  }, [refetchVault, refetchWallet]);

  async function transact(kind: "deposit" | "withdraw") {
    setError("");
    setStatus("");
    setBusy(kind);
    try {
      if (!address || !wallet.isMonadChain || !hasNativeVault) throw new Error("Hubungkan MetaMask ke Monad Testnet.");
      const value = parseMon(amount);
      if (kind === "withdraw" && value > available) throw new Error("Jumlah melebihi saldo tersedia.");
      const request =
        kind === "deposit"
          ? {
              account: address,
              address: NATIVE_VAULT,
              abi: nativeGameVaultAbi,
              functionName: "deposit" as const,
              value,
            }
          : {
              account: address,
              address: NATIVE_VAULT,
              abi: nativeGameVaultAbi,
              functionName: "withdraw" as const,
              args: [value] as const,
            };
      const client = nativeClient();
      await client.simulateContract(request);
      const data =
        kind === "deposit"
          ? encodeFunctionData({ abi: nativeGameVaultAbi, functionName: "deposit" })
          : encodeFunctionData({ abi: nativeGameVaultAbi, functionName: "withdraw", args: [value] });
      const gas = await client.estimateGas({
        account: address,
        to: NATIVE_VAULT,
        data,
        ...(kind === "deposit" ? { value } : {}),
      });
      setStatus("Konfirmasi transaksi di MetaMask.");
      const hash = await writeContractAsync({ ...request, chainId: 10143, gas });
      setStatus("Menunggu konfirmasi jaringan.");
      await confirmNativeTransaction(hash);
      await Promise.all([reads.refetch(), balance.refetch()]);
      setStatus(`${kind === "deposit" ? "Deposit" : "Penarikan"} ${formatEther(value)} MON berhasil.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Transaksi gagal.");
    } finally {
      setBusy("");
    }
  }

  return {
    mode: "chain",
    connected: Boolean(address),
    address: address || "",
    available: Number(formatEther(available)),
    locked: Number(formatEther(bidLocked + skillReserved)),
    skillBudget: Number(formatEther(skillReserved)),
    availableDisplay: formatEther(available),
    lockedDisplay: formatEther(bidLocked + skillReserved),
    walletDisplay: formatEther(balance.data?.value ?? 0n),
    amount,
    setAmount,
    busy: busy || (wallet.isConnecting ? "connect" : ""),
    status,
    error: error || wallet.error || wallet.backendAuthError,
    onFaucet: async () => {
      window.open("https://faucet.monad.xyz", "_blank", "noopener,noreferrer");
    },
    onDeposit: () => transact("deposit"),
    onWithdraw: () => transact("withdraw"),
    connect: wallet.connectWallet,
    disconnect: wallet.disconnectWallet,
    needsChainSwitch: Boolean(address) && !wallet.isMonadChain,
    switchChain: wallet.switchToMonad,
  };
}
