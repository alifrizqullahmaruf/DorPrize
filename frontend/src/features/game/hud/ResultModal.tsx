"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "@/shared/audio/sfx";
import { backendFetch } from "@/shared/backend/api";
import { formatUsdc, MAX_ROUNDS } from "@dorprize/game-core";
import { useGame } from "@/features/game/state/store";
import { IS_DEMO } from "@/features/wallet/account";
import { BIDS_ON_CHAIN } from "@/features/wallet/joinRoom";
import { explorerTxUrl } from "@/features/wallet/web3/monad";
import { useProfile } from "@/features/wallet/profile";
import { CrownIcon, TrophyIcon, UsdcIcon } from "@/shared/ui/icons";

type Settlement =
  | { status: "none" | "pending" }
  | { status: "settled"; txHash: string }
  | { status: "failed"; error: string; txHash?: string };

/** The server pays the pot on-chain right after the game; follow it until it lands. */
function useSettlement(roomId: string, enabled: boolean) {
  const [s, setS] = useState<Settlement>({ status: "pending" });
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    let tries = 0;
    const poll = async () => {
      try {
        const next = await backendFetch<Settlement>(`/rooms/${roomId}/settlement`);
        if (stop) return;
        setS(next);
        if (next.status === "settled" || next.status === "failed") return;
      } catch {
        // keep polling
      }
      if (++tries < 40 && !stop) setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      stop = true;
    };
  }, [roomId, enabled]);
  return s;
}

function Confetti() {
  const coins = useMemo(() => {
    const r = (i: number, k: number) => {
      const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    return Array.from({ length: 36 }, (_, i) => ({
      left: r(i, 1) * 100,
      delay: r(i, 2) * 1.5,
      dur: 2.2 + r(i, 3) * 1.8,
      size: 8 + r(i, 4) * 10,
      gold: i % 3 !== 0,
    }));
  }, []);
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {coins.map((c, i) => (
        <span
          key={i}
          className="absolute -top-6 block"
          style={{
            left: `${c.left}%`,
            width: c.size,
            height: c.size,
            background: c.gold ? "#f5b82e" : "#ffd76a",
            boxShadow: "inset -2px -2px 0 #c9851a",
            animation: `fall ${c.dur}s linear ${c.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

export function ResultModal() {
  const room = useGame((s) => s.room)!;
  const end = useGame((s) => s.end)!;
  const leave = useGame((s) => s.leave);
  const settleDemo = useProfile((s) => s.demoSettle);
  const addStats = useProfile((s) => s.addStats);
  const meNum = room.meNum!;
  const won = end.winners.includes(meNum);
  const split = end.winners.length > 1;
  const fees = end.skillFees[meNum] ?? 0;
  const kills = end.kills[meNum] ?? 0;
  const payout = won ? end.payoutEach : 0;
  const net = payout - room.bid - fees;
  const done = useRef(false);
  const onChain = !IS_DEMO && BIDS_ON_CHAIN;
  const settlement = useSettlement(room.roomId, onChain);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (IS_DEMO) settleDemo(room.bid, payout, fees);
    addStats(kills, won);
    if (won) sfx.win();
    else sfx.lose();
  }, [addStats, fees, kills, payout, room.bid, settleDemo, won]);

  const reasonText =
    end.reason === "mutual"
      ? "Semua yang tersisa tumbang di ronde yang sama — pot dibagi rata."
      : end.reason === "maxRounds"
        ? `Batas ${MAX_ROUNDS} ronde tercapai — pot dibagi rata di antara yang hidup.`
        : "";

  const names = end.winners.map((n) => `#${n} ${room.players.find((p) => p.num === n)?.name ?? ""}`).join(", ");

  return (
    <div className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-3 safe-inset sm:p-4">
      {won && <Confetti />}
      <div className="anim-pop relative max-h-[92dvh] w-full max-w-sm overflow-y-auto panel p-3.5 text-center sm:p-5">
        <div className={`font-pixel text-2xl sm:text-3xl ${won ? "text-gold" : "text-danger"}`}>
          {won ? (split ? "SERI!" : "MENANG!") : "KALAH"}
        </div>
        <div className="mt-1 text-xs text-ash sm:text-sm">
          {won ? (split ? "Kamu ikut berbagi pot." : "Kamu pemain terakhir yang bertahan.") : `Pemenang: ${names}`}
        </div>
        {reasonText && <div className="mt-1.5 text-[11px] text-ash sm:text-xs">{reasonText}</div>}

        {won && (
          <div className="mx-auto mt-2.5 flex w-fit items-center gap-1.5 rounded-lg bg-[#2a1f06] px-3 py-1.5 font-pixel text-xl text-gold sm:mt-4 sm:gap-2 sm:px-4 sm:py-2 sm:text-2xl">
            <UsdcIcon size={18} /> +{formatUsdc(payout)}
          </div>
        )}

        <dl className="mt-2.5 grid grid-cols-2 gap-1.5 text-left text-xs sm:mt-4 sm:gap-2">
          <div className="rounded bg-white/5 px-2 py-1 sm:py-1.5">
            <dt className="text-[10px] text-ash sm:text-xs">Bid</dt>
            <dd className="font-pixel text-xs">{formatUsdc(room.bid)} USDC</dd>
          </div>
          <div className="rounded bg-white/5 px-2 py-1 sm:py-1.5">
            <dt className="text-[10px] text-ash sm:text-xs">Biaya skill</dt>
            <dd className="font-pixel text-xs">{formatUsdc(fees)} USDC</dd>
          </div>
          <div className="rounded bg-white/5 px-2 py-1 sm:py-1.5">
            <dt className="flex items-center gap-1 text-[10px] text-ash sm:text-xs">
              <TrophyIcon size={12} /> Kill
            </dt>
            <dd className="font-pixel text-xs">+{kills}</dd>
          </div>
          <div className="rounded bg-white/5 px-2 py-1 sm:py-1.5">
            <dt className="flex items-center gap-1 text-[10px] text-ash sm:text-xs">
              <CrownIcon size={12} /> Mahkota
            </dt>
            <dd className="font-pixel text-xs">+{won ? 1 : 0}</dd>
          </div>
        </dl>
        <div className={`mt-1.5 text-xs sm:mt-2 ${net >= 0 ? "text-gold" : "text-ash"}`}>
          Bersih: {net >= 0 ? "+" : ""}
          {formatUsdc(net)} USDC
        </div>

        {onChain && (
          <div className="mt-3 rounded-lg bg-white/5 p-2 text-xs sm:mt-4">
            {settlement.status === "settled" ? (
              <>
                <div className="text-gold">✓ Pot dibayar on-chain ke saldo Vault.</div>
                <a
                  href={explorerTxUrl(settlement.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block font-mono text-[11px] text-stone underline"
                >
                  {settlement.txHash.slice(0, 10)}…{settlement.txHash.slice(-6)} ↗
                </a>
              </>
            ) : settlement.status === "failed" ? (
              <div className="text-danger">
                Pembayaran on-chain gagal: {settlement.error}. Bid bisa di-refund lewat RoomManager setelah 1 jam.
              </div>
            ) : (
              <div className="text-ash">Membayar pot on-chain…</div>
            )}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4">
          <Link href="/play" onClick={leave} className="btn-gold py-2 text-xs sm:py-2.5 sm:text-sm">
            MAIN LAGI
          </Link>
          <Link href="/" onClick={leave} className="btn-stone py-2 text-xs sm:py-2.5 sm:text-sm">
            MENU
          </Link>
        </div>
      </div>
    </div>
  );
}
