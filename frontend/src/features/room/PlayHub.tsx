"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { boardSizeFor, formatUsdc, MAX_PLAYERS, MIN_BID, MIN_PLAYERS } from "@dorprize/game-core";
import type { RoomSummary } from "@dorprize/game-core";
import { getTransport } from "@/features/game/net/transport";
import { useAccountView } from "@/features/wallet/account";
import { useProfile } from "@/features/wallet/profile";
import { WalletChip } from "@/features/wallet/components/TopBar";
import { UsdcIcon } from "@/shared/ui/icons";

const QrScanner = dynamic(() => import("@/features/room/QrScanner"), { ssr: false });

type Tab = "public" | "create" | "code";

export function PlayHub() {
  const [tab, setTab] = useState<Tab>("public");
  return (
    <main className="relative min-h-dvh w-full bg-[radial-gradient(circle_at_50%_120%,#7a2a08,#1a0703_65%)] safe-inset">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 p-3 sm:gap-4 sm:p-5 [@media(max-height:520px)]:gap-2.5 [@media(max-height:520px)]:py-2">
        <header className="flex items-start justify-between gap-2">
          <Link href="/" className="btn-stone px-3 py-1.5 text-xs sm:py-2 sm:text-sm">
            ← MENU
          </Link>
          <WalletChip />
        </header>
        <h1 className="font-pixel text-2xl text-gold [text-shadow:0_2px_0_#5b3408] sm:text-3xl [@media(max-height:520px)]:text-xl">
          PILIH ROOM
        </h1>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-black/50 p-1 shadow-[0_2px_0_#000000]">
          {(
            [
              ["public", "Room Publik"],
              ["create", "Buat Room"],
              ["code", "Kode / QR"],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md py-1.5 font-pixel text-xs transition sm:py-2 sm:text-sm ${tab === t ? "bg-gold text-ink shadow-[0_2px_0_#5b3408]" : "text-stone hover:bg-white/5"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "public" && <PublicRooms />}
        {tab === "create" && <CreateRoom />}
        {tab === "code" && <JoinByCode />}
      </div>
    </main>
  );
}

function PublicRooms() {
  const router = useRouter();
  const account = useAccountView();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const t = await getTransport();
      setRooms(await t.listRooms());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat room.");
    }
  }, []);

  useEffect(() => {
    // Initial fetch + light polling while the tab is visible; refresh on return.
    const poll = () => {
      if (document.visibilityState === "visible") void load();
    };
    const first = setTimeout(load, 0);
    const id = setInterval(poll, 4000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [load]);

  if (error) return <div className="panel p-4 text-sm text-danger">{error}</div>;
  if (!rooms) return <div className="panel p-4 font-pixel text-ash">Memuat…</div>;
  if (rooms.length === 0)
    return <div className="panel p-4 text-sm text-ash">Belum ada room publik. Buat room baru!</div>;

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {rooms.map((r) => {
        const poor = account.available < r.bid;
        return (
          <li key={r.roomId} className="flex items-center justify-between gap-3 panel p-3">
            <div className="min-w-0">
              <div className="truncate font-pixel text-stone">{r.name}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ash">
                <span className="flex items-center gap-1">
                  <UsdcIcon size={12} />
                  <b className="text-gold">{formatUsdc(r.bid)}</b> bid
                </span>
                <span>
                  {r.players}/{r.maxPlayers} pemain
                </span>
                <span>
                  {r.boardSize}×{r.boardSize}
                </span>
                <span className="font-mono">#{r.roomId}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/room/${r.roomId}`)}
              className="shrink-0 btn-gold px-4 py-2 text-sm"
              title={poor ? "Saldo kurang — klaim faucet dulu" : undefined}
            >
              MASUK
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CreateRoom() {
  const router = useRouter();
  const name = useProfile((s) => s.name);
  const [roomName, setRoomName] = useState("");
  const [bid, setBid] = useState(1);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (bid < MIN_BID) return setError(`Bid minimal ${MIN_BID} USDC.`);
    setBusy(true);
    try {
      const t = await getTransport();
      const { roomId } = await t.createRoom({
        name: roomName.trim() || `Room ${name}`,
        bid,
        maxPlayers,
        isPrivate,
      });
      router.push(`/room/${roomId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat room.");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 panel p-4">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ash">Nama room</span>
        <input
          value={roomName}
          onChange={(e) => setRoomName(e.target.value.slice(0, 24))}
          placeholder={`Room ${name}`}
          className="rounded-md border-2 border-white/10 bg-black/60 px-3 py-2 text-stone outline-none focus:border-gold"
        />
      </label>

      <div>
        <span className="text-xs text-ash">Bid per pemain (USDC)</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {[1, 2, 5, 10].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setBid(v)}
              className={`rounded-md px-4 py-2 font-pixel ${bid === v ? "bg-gold text-ink" : "bg-white/5 text-stone"}`}
            >
              {v}
            </button>
          ))}
          <input
            type="number"
            min={MIN_BID}
            value={bid}
            onChange={(e) => setBid(Math.max(0, Number(e.target.value)))}
            className="w-24 rounded-md border-2 border-white/10 bg-black/60 px-2 font-pixel text-stone outline-none focus:border-gold"
            aria-label="Bid custom"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ash">Maks pemain: {maxPlayers}</span>
          <input
            type="range"
            min={MIN_PLAYERS}
            max={MAX_PLAYERS}
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
            className="accent-[#f5b82e]"
          />
        </label>
        <div className="rounded-lg bg-white/5 px-3 py-2 text-xs text-ash">
          <b className="text-stone">Papan menyesuaikan jumlah pemain</b>
          <br />
          2–3 pemain 8×8 · 4–6 pemain 10×10 · 7–10 pemain 12×12. Menyusut 1 cincin tiap ronde sampai 2×2.
          <br />
          Jika penuh ({maxPlayers} pemain):{" "}
          <b className="text-gold">
            {boardSizeFor(maxPlayers)}×{boardSizeFor(maxPlayers)}
          </b>
        </div>
      </div>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => setIsPrivate(e.target.checked)}
          className="size-5 accent-[#f5b82e]"
        />
        <span className="text-sm">Room privat (masuk lewat QR / kode)</span>
      </label>

      <div className="rounded-lg bg-white/5 p-3 text-sm text-ash">
        Pot penuh: <b className="text-gold">{formatUsdc(bid * maxPlayers)} USDC</b> jika {maxPlayers} pemain. Tanpa
        potongan platform.
      </div>

      {error && <div className="text-sm text-danger">{error}</div>}
      <button type="button" onClick={submit} disabled={busy} className="btn-gold py-3 text-lg">
        {busy ? "MEMBUAT…" : "BUAT ROOM"}
      </button>
    </div>
  );
}

function parseRoomCode(raw: string) {
  const m = raw.match(/room\/([A-Za-z0-9]+)/);
  return (m ? m[1] : raw)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [scan, setScan] = useState(false);
  const [error, setError] = useState("");
  const go = (raw: string) => {
    const id = parseRoomCode(raw);
    if (id.length < 4) return setError("Kode room tidak valid.");
    router.push(`/room/${id}`);
  };
  return (
    <div className="flex flex-col gap-3 panel p-4">
      <label className="text-xs text-ash" htmlFor="code">
        Kode room
      </label>
      <div className="flex gap-2">
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="MISAL: K7Q2ZP"
          className="w-full rounded-md border-2 border-white/10 bg-black/60 px-3 py-2 font-pixel tracking-widest text-stone outline-none focus:border-gold"
        />
        <button type="button" onClick={() => go(code)} className="btn-gold px-4">
          MASUK
        </button>
      </div>
      <button type="button" onClick={() => setScan((v) => !v)} className="btn-stone py-2.5 text-sm">
        {scan ? "TUTUP KAMERA" : "SCAN QR ROOM PRIVAT"}
      </button>
      {scan && (
        <div className="mx-auto w-full max-w-xs">
          <QrScanner onCode={go} onError={setError} />
        </div>
      )}
      {error && <div className="text-sm text-danger">{error}</div>}
    </div>
  );
}
