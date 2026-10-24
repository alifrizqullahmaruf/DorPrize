"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { formatEther } from "viem";
import { useWallet } from "@/features/wallet/web3/WalletProvider";
import { useNativeAccount } from "./useNativeAccount";
import { hasNativeEntry, joinNativeRoom, parseMon, type NativeRoomInfo } from "./transactions";

export function NativeRoomGate({ roomId, children }: { roomId: string; children: ReactNode }) {
  const wallet = useWallet();
  const account = useNativeAccount();
  const [joinedFor, setJoinedFor] = useState("");
  const [room, setRoom] = useState<NativeRoomInfo | null>(null);
  const [budget, setBudget] = useState("0");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const identity = `${wallet.account.toLowerCase()}:${roomId}`;
  useEffect(() => {
    if (!wallet.isBackendAuthenticated || !wallet.isMonadChain) return;
    let cancelled = false;
    void hasNativeEntry(roomId)
      .then(({ room: info, entry }) => {
        if (cancelled) return;
        setRoom(info);
        if (entry.joined) setJoinedFor(identity);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Room tidak tersedia.");
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, identity, wallet.isBackendAuthenticated, wallet.isMonadChain]);
  if (wallet.isBackendAuthenticated && wallet.isMonadChain && joinedFor === identity) return children;
  const join = async () => {
    setBusy(true);
    setError("");
    try {
      await joinNativeRoom(roomId, budget);
      setJoinedFor(identity);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal masuk room.");
    } finally {
      setBusy(false);
    }
  };
  let total = "";
  try {
    if (room) total = formatEther(BigInt(room.bidWei) + parseMon(budget, true));
  } catch {
    /* Invalid input is explained on submit. */
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#1a0703] p-4">
      <div className="w-full max-w-sm panel p-5">
        <Link href="/play" className="text-xs text-ash">
          ← Kembali
        </Link>
        <h1 className="mt-4 font-pixel text-xl text-gold">{room?.name || `ROOM ${roomId}`}</h1>
        {!wallet.account ? (
          <button onClick={wallet.connectWallet} className="mt-4 w-full btn-gold py-3">
            CONNECT METAMASK
          </button>
        ) : !wallet.isMonadChain ? (
          <button onClick={wallet.switchToMonad} className="mt-4 w-full btn-gold py-3">
            PINDAH KE MONAD TESTNET
          </button>
        ) : !wallet.isBackendAuthenticated ? (
          <button
            disabled={wallet.isBackendAuthLoading}
            onClick={() => void wallet.ensureBackendSession()}
            className="mt-4 w-full btn-gold py-3"
          >
            {wallet.isBackendAuthLoading ? "MENUNGGU TANDA TANGAN…" : "LOGIN GAME"}
          </button>
        ) : room ? (
          <>
            <p className="mt-3 text-sm text-ash">
              Bid {formatEther(BigInt(room.bidWei))} MON · Tersedia {account.availableDisplay} MON
            </p>
            <label className="mt-4 block text-sm text-ash">
              Budget skill (MON)
              <input
                inputMode="decimal"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                className="mt-1 w-full rounded-md border-2 border-white/10 bg-black/60 px-3 py-2 font-mono text-stone"
              />
            </label>
            <p className="mt-2 text-xs text-ash">
              Budget 0 berarti bermain tanpa skill berbayar. Sisa budget kembali ke saldo tersedia setelah game selesai.
            </p>
            <button disabled={busy || !total} onClick={() => void join()} className="mt-4 w-full btn-gold py-3">
              {busy ? "KONFIRMASI DI METAMASK…" : `JOIN ROOM · KUNCI ${total || "—"} MON`}
            </button>
          </>
        ) : (
          <p className="mt-4 text-sm text-ash">Memuat room…</p>
        )}
        {(error || wallet.error || wallet.backendAuthError) && (
          <p className="mt-3 text-sm text-danger">{error || wallet.error || wallet.backendAuthError}</p>
        )}
      </div>
    </main>
  );
}
