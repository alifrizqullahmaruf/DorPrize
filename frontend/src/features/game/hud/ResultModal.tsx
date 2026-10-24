"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "@/shared/audio/sfx";
import { backendFetch, backendPost } from "@/shared/backend/api";
import { ASSET_SYMBOL, getNativeSession, NATIVE_MODE } from "@/shared/backend/native";
import { formatEther } from "viem";
import { formatUsdc, MAX_ROUNDS } from "@dorprize/game-core";
import { useGame } from "@/features/game/state/store";
import { IS_DEMO } from "@/features/wallet/account";
import { BIDS_LOCKED } from "@/features/wallet/joinRoom";
import { useProfile } from "@/features/wallet/profile";
import { CrownIcon, TrophyIcon, UsdcIcon } from "@/shared/ui/icons";

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
  const [claim, setClaim] = useState<"" | "busy" | "ok" | "err">("");
  const [claimMsg, setClaimMsg] = useState("");
  const [exactPayout, setExactPayout] = useState<string | null>(null);

  type NativeResult = {
    status: string;
    txHash: string | null;
    result: { recipients: string[]; amountsWei: string[] } | null;
  };
  const applyNativeResult = (response: NativeResult) => {
    const address = getNativeSession()?.address.toLowerCase();
    if (response.result) {
      const index = response.result.recipients.findIndex((recipient) => recipient.toLowerCase() === address);
      setExactPayout(index < 0 ? "0" : formatEther(BigInt(response.result.amountsWei[index])));
    }
    if (response.status === "settled" && response.txHash) {
      setClaim("ok");
      setClaimMsg("Settlement terkonfirmasi. Saldo Vault sudah diperbarui.");
      window.dispatchEvent(new Event("dorprize:native-balance"));
    } else if (response.status === "cancelled") {
      setClaim("err");
      setClaimMsg("Match dibatalkan. Cadangan dikembalikan mengikuti refund kontrak.");
    } else setClaimMsg("Menunggu konfirmasi settlement di jaringan.");
  };

  useEffect(() => {
    if (!NATIVE_MODE) return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await backendFetch<NativeResult>(`/matches/${encodeURIComponent(room.roomId)}/result`);
        if (!stopped) {
          applyNativeResult(result);
          if (!["settled", "cancelled"].includes(result.status)) timer = setTimeout(poll, 2500);
        }
      } catch {
        if (!stopped) timer = setTimeout(poll, 5000);
      }
    };
    let timer: ReturnType<typeof setTimeout>;
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // Result records remain bound to this match; token/account changes unmount the room gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.roomId]);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (IS_DEMO) settleDemo(room.bid, payout, fees);
    addStats(kills, won);
    if (won) sfx.win();
    else sfx.lose();
  }, [addStats, fees, kills, payout, room.bid, settleDemo, won]);

  const onClaim = async () => {
    setClaim("busy");
    try {
      const result = await backendPost<NativeResult>("/api/game/submit-settlement", { roomId: room.roomId });
      if (NATIVE_MODE) {
        setClaim("");
        applyNativeResult(result);
      } else {
        setClaim("ok");
        setClaimMsg("Settlement terkirim. Hadiah masuk saldo Vault.");
      }
    } catch (e) {
      setClaim("err");
      setClaimMsg(e instanceof Error ? e.message : "Gagal klaim.");
    }
  };

  const reasonText =
    end.reason === "mutual"
      ? "Semua yang tersisa tumbang di ronde yang sama — pot dibagi rata."
      : end.reason === "maxRounds"
        ? `Batas ${MAX_ROUNDS} ronde tercapai — pot dibagi rata di antara yang hidup.`
        : "";

  const names = end.winners.map((n) => `#${n} ${room.players.find((p) => p.num === n)?.name ?? ""}`).join(", ");

  return (
    <div className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      {won && <Confetti />}
      <div className="anim-pop relative max-h-[94dvh] w-full max-w-sm overflow-y-auto panel p-5 text-center">
        <div className={`font-pixel text-3xl ${won ? "text-gold" : "text-danger"}`}>
          {won ? (split ? "SERI!" : "MENANG!") : "KALAH"}
        </div>
        <div className="mt-1 text-sm text-ash">
          {won ? (split ? "Kamu ikut berbagi pot." : "Kamu pemain terakhir yang bertahan.") : `Pemenang: ${names}`}
        </div>
        {reasonText && <div className="mt-2 text-xs text-ash">{reasonText}</div>}

        {won && (
          <div className="mx-auto mt-4 flex w-fit items-center gap-2 rounded-lg bg-[#2a1f06] px-4 py-2 font-pixel text-2xl text-gold">
            <UsdcIcon size={22} /> +{NATIVE_MODE ? (exactPayout ?? "…") : formatUsdc(payout)}
          </div>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-2 text-left text-xs">
          <div className="rounded bg-white/5 px-2 py-1.5">
            <dt className="text-ash">Bid</dt>
            <dd className="font-pixel">
              {formatUsdc(room.bid)} {ASSET_SYMBOL}
            </dd>
          </div>
          <div className="rounded bg-white/5 px-2 py-1.5">
            <dt className="text-ash">Biaya skill</dt>
            <dd className="font-pixel">
              {formatUsdc(fees)} {ASSET_SYMBOL}
            </dd>
          </div>
          <div className="rounded bg-white/5 px-2 py-1.5">
            <dt className="flex items-center gap-1 text-ash">
              <TrophyIcon size={12} /> Kill
            </dt>
            <dd className="font-pixel">+{kills}</dd>
          </div>
          <div className="rounded bg-white/5 px-2 py-1.5">
            <dt className="flex items-center gap-1 text-ash">
              <CrownIcon size={12} /> Mahkota
            </dt>
            <dd className="font-pixel">+{won ? 1 : 0}</dd>
          </div>
        </dl>
        <div className={`mt-2 text-xs ${net >= 0 ? "text-gold" : "text-ash"}`}>
          Bersih: {net >= 0 ? "+" : ""}
          {formatUsdc(net)} {ASSET_SYMBOL}
        </div>

        {/* On-chain claim needs locked bids (backend settlement). */}
        {!IS_DEMO && BIDS_LOCKED && won && (
          <button
            type="button"
            onClick={onClaim}
            disabled={claim === "busy" || claim === "ok"}
            className="mt-4 w-full btn-gold py-3 text-lg"
          >
            {claim === "busy" ? "MENGKLAIM…" : claim === "ok" ? "TERKLAIM ✓" : "KLAIM HADIAH"}
          </button>
        )}
        {claimMsg && <div className={`mt-2 text-xs ${claim === "err" ? "text-danger" : "text-gold"}`}>{claimMsg}</div>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link href="/play" onClick={leave} className="btn-gold py-2.5 text-sm">
            MAIN LAGI
          </Link>
          <Link href="/" onClick={leave} className="btn-stone py-2.5 text-sm">
            MENU
          </Link>
        </div>
      </div>
    </div>
  );
}
