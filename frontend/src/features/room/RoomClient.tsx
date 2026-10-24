"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { use, useEffect, useRef, useState } from "react";
import { sfx } from "@/shared/audio/sfx";
import { formatUsdc, SKINS } from "@dorprize/game-core";
import { useDeathShown, useGame } from "@/features/game/state/store";
import { secondsUntil, useNow } from "@/shared/hooks/useNow";
import { useAccountView } from "@/features/wallet/account";
import { BIDS_LOCKED, useJoinRoomTx } from "@/features/wallet/joinRoom";
import { useProfile } from "@/features/wallet/profile";
import { GameHud } from "@/features/game/hud/GameHud";
import { Controls } from "@/features/game/components/Controls";
import { UsdcIcon } from "@/shared/ui/icons";
import { WalletChip } from "@/features/wallet/components/TopBar";
import { GameCanvas } from "@/features/game/components/GameCanvas";
import { SkinPreview } from "@/features/game/three/SkinPreview";

export function RoomClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const roomId = id.toUpperCase();
  const hydrated = useProfile((s) => s.hydrated);
  const skin = useProfile((s) => s.skin);
  const join = useGame((s) => s.join);
  const phase = useGame((s) => s.phase);
  const deathShown = useDeathShown();
  const tx = useJoinRoomTx();
  const end = useGame((s) => s.end);
  const bidLocked = useRef<{ roomId: string; bid: number } | null>(null);
  const started = useRef(false);
  const spent = useRef(0);

  // Remember whether the game started, so leaving refunds or forfeits correctly.
  useEffect(
    () =>
      useGame.subscribe((s) => {
        if (s.phase === "input" || s.phase === "animation" || s.phase === "result") started.current = true;
        spent.current = Math.max(spent.current, s.spent);
      }),
    [],
  );
  // ResultModal settles a finished game itself.
  useEffect(() => {
    if (end) bidLocked.current = null;
  }, [end]);

  // Join on mount, leave on unmount (also when Next hides this page).
  useEffect(() => {
    if (!hydrated) return;
    const p = useProfile.getState();
    started.current = false;
    spent.current = 0;
    void join(roomId, p.name, p.skin);
    return () => {
      const locked = bidLocked.current;
      if (locked) {
        if (!started.current) void tx.releaseBid(locked.roomId, locked.bid);
        else tx.forfeitBid(locked.bid, spent.current);
        bidLocked.current = null;
      }
      useGame.getState().leave();
    };
    // name/skin changes are sent separately; don't rejoin for them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, roomId, join]);

  useEffect(() => {
    useGame.getState().setSkin(skin);
  }, [skin]);

  const inGame = phase === "input" || phase === "animation" || phase === "result" || phase === "finished";

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#1a0703]">
      <div className={`absolute inset-0 transition-[filter] duration-700 ${inGame && deathShown ? "grayscale" : ""}`}>
        <GameCanvas />
      </div>
      {inGame && !deathShown && phase !== "finished" && <Controls />}
      {inGame ? <GameHud /> : <Lobby roomId={roomId} onLocked={(bid) => (bidLocked.current = { roomId, bid })} />}
    </main>
  );
}

function Lobby({ roomId, onLocked }: { roomId: string; onLocked: (bid: number) => void }) {
  const room = useGame((s) => s.room);
  const phase = useGame((s) => s.phase);
  const error = useGame((s) => s.error);
  const setReady = useGame((s) => s.setReady);
  const leave = useGame((s) => s.leave);
  const skin = useProfile((s) => s.skin);
  const setSkin = useProfile((s) => s.setSkin);
  const account = useAccountView();
  const tx = useJoinRoomTx();
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState("");
  const now = useNow(phase === "countdown", 200);

  const secs = room?.countdownEndsAt ? secondsUntil(room.countdownEndsAt, now) : 0;
  const lastTick = useRef(-1);
  useEffect(() => {
    if (phase === "countdown" && secs > 0 && secs <= 5 && lastTick.current !== secs) {
      lastTick.current = secs;
      sfx.tick();
    }
  }, [phase, secs]);

  if (!room) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50">
        <div className="font-pixel text-ash">{error || "Masuk ke room…"}</div>
        <Link href="/play" className="btn-stone px-4 py-2 text-sm">
          ← Kembali
        </Link>
      </div>
    );
  }

  // room only exists client-side (after joining), so window is available here
  const url = `${window.location.origin}/room/${roomId}`;
  const me = room.players.find((p) => p.num === room.meNum);
  const ready = !!me?.ready;
  const poor = BIDS_LOCKED && account.available < room.bid;

  const onReady = async () => {
    setJoinError("");
    if (poor) return setJoinError("Saldo tersedia kurang. Klaim faucet lalu deposit dulu.");
    setBusy(true);
    try {
      const ok = await tx.lockBid(room.roomId, room.bid);
      if (!ok) {
        setJoinError("Gagal mengunci bid.");
        return;
      }
      onLocked(room.bid);
      setReady(true);
      sfx.lock();
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : "Transaksi gagal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 overflow-y-auto bg-black/55 safe-inset">
      <div className="mx-auto flex max-w-4xl flex-col gap-2.5 p-3 sm:gap-3 sm:p-5 [@media(max-height:520px)]:py-2">
        <header className="flex items-start justify-between gap-2">
          <Link href="/play" onClick={leave} className="btn-stone px-3 py-1.5 text-xs sm:py-2 sm:text-sm">
            ← KELUAR
          </Link>
          <WalletChip />
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2 panel p-3 sm:gap-3 sm:p-4 [@media(max-height:520px)]:p-2.5">
          <div>
            <div className="font-pixel text-xl text-gold sm:text-2xl">{room.name}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ash sm:text-sm">
              <span className="font-mono">#{room.roomId}</span>
              <span>
                Papan {room.boardSize}×{room.boardSize} (otomatis)
              </span>
              <span>
                {room.players.length}/{room.maxPlayers} pemain
              </span>
              <span>{room.isPrivate ? "Privat" : "Publik"}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-ash sm:text-xs">Pot sekarang</div>
            <div className="flex items-center justify-end gap-1.5 font-pixel text-xl text-gold sm:text-2xl">
              <UsdcIcon size={18} />
              {formatUsdc(room.pot)}
            </div>
            <div className="text-[10px] text-ash sm:text-xs">bid {formatUsdc(room.bid)} USDC / pemain</div>
          </div>
        </div>

        {phase === "countdown" && (
          <div className="anim-pop flex flex-col items-center panel p-3 sm:p-5 [@media(max-height:520px)]:p-2.5">
            <div className="font-pixel text-xs text-ash sm:text-sm">GAME DIMULAI DALAM</div>
            <div
              key={secs}
              className="anim-pop font-pixel text-5xl text-gold sm:text-7xl [@media(max-height:520px)]:text-4xl"
            >
              {secs}
            </div>
            <div className="text-center text-[10px] text-ash sm:text-xs">
              {BIDS_LOCKED && "Bid terkunci. "}Lawan hanya terlihat saat adu tembak — percayai firasatmu.
            </div>
          </div>
        )}

        <div className="grid gap-2.5 sm:gap-3 md:grid-cols-[1fr_1.1fr]">
          <section className="panel p-3 sm:p-4 [@media(max-height:520px)]:p-2.5">
            <h2 className="font-pixel text-xs text-ash sm:text-sm">PEMAIN</h2>
            <ul className="mt-2 grid grid-cols-2 gap-1.5 sm:gap-2">
              {room.players.map((p) => (
                <li
                  key={p.num}
                  className={`flex items-center gap-1.5 rounded-lg p-1.5 sm:gap-2 sm:p-2 ${p.num === room.meNum ? "bg-[#3a2a08]" : "bg-white/5"}`}
                >
                  <SkinPreview skin={p.skin} scale={1.2} />
                  <div className="min-w-0">
                    <div className="font-pixel text-[10px] text-ash sm:text-xs">#{p.num}</div>
                    <div className="truncate text-xs sm:text-sm">{p.name}</div>
                    <div className={`font-pixel text-[9px] sm:text-[10px] ${p.ready ? "text-gold" : "text-ash"}`}>
                      {p.ready ? "SIAP" : "MENUNGGU"}
                    </div>
                  </div>
                </li>
              ))}
              {Array.from({ length: Math.max(0, room.maxPlayers - room.players.length) }).map((_, i) => (
                <li
                  key={`empty-${i}`}
                  className="flex h-[54px] items-center justify-center rounded-lg border-2 border-dashed border-white/10 text-xs text-ash sm:h-[66px]"
                >
                  kosong
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-2.5 sm:gap-3">
            <div className="panel p-3 sm:p-4 [@media(max-height:520px)]:p-2.5">
              <h2 className="font-pixel text-xs text-ash sm:text-sm">PILIH SKIN</h2>
              <div className="mt-2 grid grid-cols-4 gap-1.5 sm:gap-2">
                {SKINS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={ready}
                    onClick={() => setSkin(s.id)}
                    className={`flex flex-col items-center rounded-lg border-2 p-1 transition sm:p-1.5 ${
                      skin === s.id ? "border-gold bg-[#3a2a08]" : "border-transparent bg-white/5 hover:bg-white/10"
                    } disabled:opacity-60`}
                  >
                    <SkinPreview skin={s.id} scale={1.5} />
                    <span className="mt-1 text-center font-pixel text-[8px] leading-tight sm:text-[9px]">{s.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 panel p-3 sm:gap-4 sm:p-4 [@media(max-height:520px)]:p-2.5">
              <div className="shrink-0 rounded bg-white p-1 sm:p-1.5">
                <QRCodeSVG value={url} size={76} bgColor="#ffffff" fgColor="#111111" />
              </div>
              <div className="min-w-0 text-xs sm:text-sm">
                <div className="font-pixel text-[10px] text-ash sm:text-xs">AJAK TEMAN</div>
                <div className="mt-0.5 text-ash">Scan QR atau masukkan kode:</div>
                <div className="font-pixel text-xl tracking-widest text-stone sm:text-2xl">{room.roomId}</div>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(url)}
                  className="mt-1 btn-stone px-2 py-0.5 text-[10px] sm:text-[11px]"
                >
                  SALIN LINK
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="sticky bottom-0 -mx-3 bg-linear-to-t from-black/90 to-transparent p-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:-mx-5 sm:p-5">
          {joinError && <div className="mb-1.5 text-center text-xs text-danger sm:text-sm">{joinError}</div>}
          {poor && !ready && (
            <div className="mb-1.5 text-center text-[10px] text-ash sm:text-xs">
              Saldo tersedia {formatUsdc(account.available)} USDC — klik Faucet di kanan atas.
            </div>
          )}
          <button
            type="button"
            onClick={onReady}
            disabled={ready || busy || phase !== "lobby"}
            className="w-full btn-gold py-2.5 text-base sm:py-4 sm:text-xl [@media(max-height:520px)]:py-2 [@media(max-height:520px)]:text-sm"
          >
            {ready
              ? "SIAP ✓ — MENUNGGU MULAI"
              : busy
                ? "MENGUNCI BID…"
                : BIDS_LOCKED
                  ? `JOIN & SIAP · kunci ${formatUsdc(room.bid)} USDC`
                  : "SIAP"}
          </button>
        </div>
      </div>
    </div>
  );
}
