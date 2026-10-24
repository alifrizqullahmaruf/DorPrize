"use client";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- vendored from PassChick */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { SiweMessage } from "siwe";
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { validateNativeChallenge } from "@/features/wallet/native/validation";
import { getAccount } from "@wagmi/core";
import { backendFetch, backendPost } from "@/shared/backend/api";
import { BACKEND_API_URL, hasBackendApiConfig } from "@/shared/backend/config";
import { openLegacyWallet, wagmiAdapter } from "@/features/wallet/web3/appKit";
import { getNativeSession, NATIVE_MODE, setNativeSession } from "@/shared/backend/native";
import { MONAD_CHAIN, hasMonadChainConfig } from "@/features/wallet/web3/monad";
import { readRawErrorMessage, toUserFacingWalletError } from "@/shared/lib/errors";

type WalletContextValue = {
  account: string;
  chainIdHex: string;
  isMonadChain: boolean;
  isConnecting: boolean;
  error: string;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  switchToMonad: () => Promise<void>;
  clearWalletError: () => void;
  hasMonadChainConfig: boolean;
  monadChainIdHex: string;
  monadChainName: string;
  backendApiUrl: string;
  hasBackendApiConfig: boolean;
  isBackendAuthenticated: boolean;
  isBackendAuthLoading: boolean;
  backendAuthError: string;
  authenticateBackend: () => Promise<boolean>;
  ensureBackendSession: () => Promise<boolean>;
  logoutBackend: () => Promise<void>;
  refreshBackendSession: () => Promise<boolean>;
};

type WalletProviderProps = {
  children: ReactNode;
};

type AddChainArguments = {
  method: "wallet_addEthereumChain";
  params: Array<{
    chainId: string;
    chainName: string;
    nativeCurrency: {
      name: string;
      symbol: string;
      decimals: number;
    };
    rpcUrls: string[];
    blockExplorerUrls: string[];
  }>;
};

type Eip1193Provider = {
  request: (args: AddChainArguments) => Promise<unknown>;
};

type ChainSwitchError = {
  code?: number;
  message?: string;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

function toHexChainId(chainId: number | undefined) {
  if (!chainId) return "";
  return `0x${chainId.toString(16)}`;
}

function readSwitchErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return Number((error as ChainSwitchError).code);
  }
  return null;
}

function readErrorMessage(error: unknown, fallback: string) {
  return readRawErrorMessage(error, fallback);
}

function getEip1193Provider() {
  if (typeof window === "undefined") return null;
  const runtimeWindow = window as Window & { ethereum?: Eip1193Provider };
  return runtimeWindow.ethereum || null;
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [error, setError] = useState("");
  const [isAppKitOpening, setIsAppKitOpening] = useState(false);
  const [backendAddress, setBackendAddress] = useState("");
  const [backendAuthLoading, setBackendAuthLoading] = useState(false);
  const [backendAuthError, setBackendAuthError] = useState("");
  const backendSessionRef = useRef<{
    inFlight: Promise<boolean> | null;
    lastCheckedAt: number;
    lastResult: boolean;
    account: string;
  }>({
    inFlight: null,
    lastCheckedAt: 0,
    lastResult: false,
    account: "",
  });
  const { connectAsync, connectors } = useConnect();
  const { address, chainId, isConnected, status: connectionStatus } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync, isPending: isSwitchPending } = useSwitchChain();

  const chainIdHex = toHexChainId(chainId);
  const account = address || "";
  const normalizedAccount = account.toLowerCase();
  const hasMonadConfig = hasMonadChainConfig();
  const hasBackendConfig = hasBackendApiConfig();
  const isMonadChain = hasMonadConfig && chainIdHex.toLowerCase() === (MONAD_CHAIN.chainIdHex || "").toLowerCase();
  const isConnecting = isAppKitOpening || isSwitchPending;
  const isBackendAuthenticated =
    Boolean(backendAddress) && Boolean(normalizedAccount) && backendAddress.toLowerCase() === normalizedAccount;

  async function connectWallet() {
    setError("");
    setIsAppKitOpening(true);

    try {
      if (NATIVE_MODE) {
        const connector = connectors.find((candidate) => candidate.id === "metaMask" || candidate.name === "MetaMask");
        if (!connector) throw new Error("Pasang MetaMask untuk menghubungkan wallet.");
        await connectAsync({ connector });
      } else await openLegacyWallet();
    } catch (connectError) {
      setError(
        toUserFacingWalletError(connectError, "Failed to open wallet modal.", {
          userRejectedMessage: "Connect wallet was canceled.",
        }),
      );
    } finally {
      setIsAppKitOpening(false);
    }
  }

  async function disconnectWallet() {
    setError("");
    setBackendAddress("");
    setBackendAuthError("");

    try {
      await disconnectAsync();
    } catch {
      // Keep frontend state cleared even if the wallet adapter throws.
    }

    if (hasBackendConfig) {
      await logoutBackend();
    }
  }

  async function addMonadChainToWallet() {
    const provider = getEip1193Provider();
    if (!provider) {
      setError("EVM wallet not detected.");
      return;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: MONAD_CHAIN.chainIdHex,
          chainName: MONAD_CHAIN.chainName,
          nativeCurrency: MONAD_CHAIN.nativeCurrency,
          rpcUrls: MONAD_CHAIN.rpcUrls,
          blockExplorerUrls: MONAD_CHAIN.blockExplorerUrls,
        },
      ],
    });
  }

  async function switchToMonad() {
    if (!isConnected) {
      setError("Connect wallet first before switching chain.");
      return;
    }

    if (!hasMonadConfig) {
      setError("Monad config is incomplete. Fill the variables in frontend/.env.local.");
      return;
    }

    setError("");

    try {
      await switchChainAsync({ chainId: MONAD_CHAIN.chainIdDecimal });
      return;
    } catch (switchError) {
      const switchCode = readSwitchErrorCode(switchError);
      const shouldTryAddChain =
        switchCode === 4902 || readErrorMessage(switchError, "").toLowerCase().includes("unrecognized");

      if (!shouldTryAddChain) {
        setError(
          toUserFacingWalletError(switchError, "Failed to switch to Monad chain.", {
            userRejectedMessage: "Chain switch was canceled in wallet.",
          }),
        );
        return;
      }
    }

    try {
      await addMonadChainToWallet();
      await switchChainAsync({ chainId: MONAD_CHAIN.chainIdDecimal });
    } catch (addChainError) {
      setError(
        toUserFacingWalletError(addChainError, "Failed to add Monad chain.", {
          userRejectedMessage: "Adding chain was canceled in wallet.",
        }),
      );
    }
  }

  async function refreshBackendSession() {
    if (!hasBackendConfig) {
      setBackendAddress("");
      return false;
    }
    if (NATIVE_MODE && !getNativeSession()) {
      setBackendAddress("");
      return false;
    }

    const now = Date.now();
    const snapshot = backendSessionRef.current;
    const sameAccount = snapshot.account === normalizedAccount;
    const cooldownMs = snapshot.lastResult ? 12_000 : 4_000;

    if (snapshot.inFlight) {
      return snapshot.inFlight;
    }

    if (sameAccount && now - snapshot.lastCheckedAt < cooldownMs) {
      return snapshot.lastResult;
    }

    const task = (async () => {
      setBackendAuthLoading(true);
      try {
        const response = await backendFetch<{
          authenticated: boolean;
          address: string;
        }>(NATIVE_MODE ? "/auth/session" : "/auth/me");
        const sessionAddress = response.address?.toLowerCase?.() || "";
        if (!sessionAddress || (normalizedAccount && sessionAddress !== normalizedAccount)) {
          setBackendAddress("");
          backendSessionRef.current = {
            inFlight: null,
            lastCheckedAt: Date.now(),
            lastResult: false,
            account: normalizedAccount,
          };
          return false;
        }

        setBackendAddress(sessionAddress);
        setBackendAuthError("");
        backendSessionRef.current = {
          inFlight: null,
          lastCheckedAt: Date.now(),
          lastResult: true,
          account: normalizedAccount,
        };
        return true;
      } catch {
        setBackendAddress("");
        backendSessionRef.current = {
          inFlight: null,
          lastCheckedAt: Date.now(),
          lastResult: false,
          account: normalizedAccount,
        };
        return false;
      } finally {
        setBackendAuthLoading(false);
        backendSessionRef.current.inFlight = null;
      }
    })();

    backendSessionRef.current = {
      ...backendSessionRef.current,
      inFlight: task,
      account: normalizedAccount,
    };

    return task;
  }

  async function authenticateBackend() {
    if (!hasBackendConfig) {
      setBackendAuthError("Backend config is incomplete. Set NEXT_PUBLIC_BACKEND_API_URL first.");
      return false;
    }
    if (!isConnected || !account) {
      setBackendAuthError("Connect wallet first before signing in to backend.");
      return false;
    }
    if (NATIVE_MODE && (!isMonadChain || chainId !== 10143)) {
      setBackendAuthError("Pindah ke Monad Testnet sebelum login.");
      return false;
    }

    setBackendAuthLoading(true);
    setBackendAuthError("");

    try {
      if (NATIVE_MODE) {
        const challenge = await backendPost<{ challengeId: string; message: string; expiresAt: number }>(
          "/auth/challenge",
          { address: account },
        );
        validateNativeChallenge(challenge, account, window.location.origin);
        const signature = await signMessageAsync({ message: challenge.message, account: address });
        const result = await backendPost<{ token: string; address: string; expiresAt: number }>("/auth/verify", {
          challengeId: challenge.challengeId,
          signature,
        });
        const current = getAccount(wagmiAdapter.wagmiConfig);
        if (current.address?.toLowerCase() !== normalizedAccount || current.chainId !== 10143)
          throw new Error("Wallet berubah saat login. Silakan login ulang.");
        if (
          result.address.toLowerCase() !== normalizedAccount ||
          !/^[0-9a-f]{64}$/.test(result.token) ||
          result.expiresAt <= Date.now()
        )
          throw new Error("Sesi backend tidak valid.");
        setNativeSession(result);
        setBackendAddress(normalizedAccount);
        backendSessionRef.current = {
          inFlight: null,
          lastCheckedAt: Date.now(),
          lastResult: true,
          account: normalizedAccount,
        };
        return true;
      }
      const { nonce } = await backendFetch<{ nonce: string }>("/auth/nonce");
      const domain = window.location.host;
      const origin = window.location.origin;
      const chainIdToUse = chainId || MONAD_CHAIN.chainIdDecimal || 10143;
      const statement = "Sign in to DOR PRIZE.";
      const siweMessage = new SiweMessage({
        domain,
        address: account,
        statement,
        uri: origin,
        version: "1",
        chainId: chainIdToUse,
        nonce,
      });
      const message = siweMessage.prepareMessage();
      const signature = await signMessageAsync({ message });

      await backendPost<{ success: boolean; address: string }>("/auth/verify", {
        message,
        signature,
      });

      const nextAddress = account.toLowerCase();
      setBackendAddress(nextAddress);
      setBackendAuthError("");
      backendSessionRef.current = {
        inFlight: null,
        lastCheckedAt: Date.now(),
        lastResult: true,
        account: nextAddress,
      };
      return true;
    } catch (authError) {
      setBackendAddress("");
      backendSessionRef.current = {
        inFlight: null,
        lastCheckedAt: Date.now(),
        lastResult: false,
        account: normalizedAccount,
      };
      setBackendAuthError(
        toUserFacingWalletError(authError, "Failed to authenticate with backend.", {
          userRejectedMessage: "Backend sign-in was canceled in wallet.",
        }),
      );
      return false;
    } finally {
      setBackendAuthLoading(false);
    }
  }

  async function ensureBackendSession() {
    if (!hasBackendConfig) {
      return false;
    }
    if (isBackendAuthenticated) {
      return true;
    }

    const hasExistingSession = await refreshBackendSession();
    if (hasExistingSession) {
      return true;
    }

    return authenticateBackend();
  }

  async function logoutBackend() {
    if (!hasBackendConfig) {
      setBackendAddress("");
      return;
    }

    try {
      await backendPost<{ success: boolean }>("/auth/logout");
    } catch {
      // Ignore logout failures on local dev; frontend state is still cleared.
    } finally {
      if (NATIVE_MODE) setNativeSession(null);
      setBackendAddress("");
      setBackendAuthError("");
      setBackendAuthLoading(false);
    }
  }

  useEffect(() => {
    if (NATIVE_MODE) {
      const existing = getNativeSession();
      if (
        existing &&
        (connectionStatus === "disconnected" ||
          (connectionStatus === "connected" && (!isMonadChain || existing.address.toLowerCase() !== normalizedAccount)))
      ) {
        setNativeSession(null);
        backendSessionRef.current = { inFlight: null, lastCheckedAt: 0, lastResult: false, account: normalizedAccount };
        setBackendAddress("");
      }
    }
    if (!isConnected) {
      setError("");
      setBackendAddress("");
      setBackendAuthError("");
    }
  }, [isConnected, normalizedAccount, isMonadChain, connectionStatus]);

  useEffect(() => {
    if (!NATIVE_MODE) return;
    const syncSession = () => {
      const current = getNativeSession();
      const valid = current?.address.toLowerCase() === normalizedAccount && isMonadChain;
      setBackendAddress(valid ? current!.address.toLowerCase() : "");
      if (!valid)
        backendSessionRef.current = { inFlight: null, lastCheckedAt: 0, lastResult: false, account: normalizedAccount };
    };
    window.addEventListener("dorprize:native-session", syncSession);
    return () => window.removeEventListener("dorprize:native-session", syncSession);
  }, [normalizedAccount, isMonadChain]);

  useEffect(() => {
    if (!hasBackendConfig || !isConnected || !account) {
      setBackendAddress("");
      return;
    }

    void refreshBackendSession();
  }, [account, hasBackendConfig, isConnected]);

  const value = useMemo<WalletContextValue>(
    () => ({
      account,
      chainIdHex,
      isMonadChain,
      isConnecting,
      error,
      connectWallet,
      disconnectWallet,
      switchToMonad,
      clearWalletError: () => setError(""),
      hasMonadChainConfig: hasMonadConfig,
      monadChainIdHex: MONAD_CHAIN.chainIdHex,
      monadChainName: MONAD_CHAIN.chainName,
      backendApiUrl: BACKEND_API_URL,
      hasBackendApiConfig: hasBackendConfig,
      isBackendAuthenticated,
      isBackendAuthLoading: backendAuthLoading,
      backendAuthError,
      authenticateBackend,
      ensureBackendSession,
      logoutBackend,
      refreshBackendSession,
    }),
    [
      account,
      backendAuthError,
      backendAuthLoading,
      chainIdHex,
      error,
      hasBackendConfig,
      hasMonadConfig,
      isBackendAuthenticated,
      isConnecting,
      isMonadChain,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWallet must be used inside WalletProvider.");
  }
  return value;
}
