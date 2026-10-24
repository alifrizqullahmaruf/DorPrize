"use client";

import Link from "next/link";
import { useState } from "react";
import { ProfileChip, WalletChip } from "@/features/wallet/components/TopBar";
import { MenuBackdrop } from "@/features/menu/MenuBackdrop";
import { Logo } from "@/shared/ui/Logo";
import { ASSET_SYMBOL } from "@/shared/backend/native";

export function MainMenu() {
  const [help, setHelp] = useState(false);
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <div className="absolute inset-0">
        <MenuBackdrop />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.45),transparent_35%,transparent_65%,rgba(0,0,0,0.55))]" />

      <div className="relative z-10 flex h-full flex-col p-3 sm:p-5">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <ProfileChip />
          <WalletChip />
        </header>

        <div className="flex flex-1 flex-col items-center justify-start pt-4 sm:pt-2">
          <Logo className="w-[min(78vw,460px)]" />
          <p className="mt-1 max-w-md text-center text-sm text-stone/90 [text-shadow:0_2px_0_#000]">
            Tembak tanpa melihat lawan. Bertahan dari lava. Pemain terakhir mengambil seluruh pot.
          </p>
        </div>

        <footer className="flex items-end justify-between gap-3">
          <button type="button" onClick={() => setHelp(true)} className="btn-stone px-4 py-3 text-sm">
            CARA MAIN
          </button>
          <Link href="/play" className="btn-gold px-8 py-4 text-2xl sm:px-12 sm:py-5 sm:text-3xl">
            MAINKAN
          </Link>
        </footer>
      </div>

      {help && <HowToPlay onClose={() => setHelp(false)} />}
    </main>
  );
}

function HowToPlay({ onClose }: { onClose: () => void }) {
  const steps = [
    ["Masuk room", `Pilih room, kunci bid (min. 1 ${ASSET_SYMBOL}). Pot = bid × jumlah pemain.`],
    [
      "15 detik rahasia",
      "Pilih langkah (8 arah atau diam), arah tembak, dan opsional 1 skill. Lawan tidak pernah terlihat.",
    ],
    [
      "DOR!",
      "Semua aksi diselesaikan serentak dari petak tujuan. Peluru lurus sampai mengenai petak terisi pertama. Satu kena = tumbang.",
    ],
    [
      "Arena menyusut",
      "Papan menyesuaikan jumlah pemain (8×8 / 10×10 / 12×12). Tiap ronde cincin terluar tenggelam sampai 2×2 — yang berdiri di sana otomatis terdorong ke dalam.",
    ],
    ["Menang", "Terakhir hidup ambil seluruh pot. Mati bersamaan atau 20 ronde = pot dibagi rata."],
  ];
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="anim-pop max-h-[90dvh] w-full max-w-md overflow-y-auto panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-pixel text-xl text-gold">CARA MAIN</h2>
        <ol className="mt-3 space-y-3">
          {steps.map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded bg-gold font-pixel text-ink">
                {i + 1}
              </span>
              <div>
                <div className="font-pixel text-sm text-stone">{t}</div>
                <div className="text-sm text-ash">{d}</div>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-4 rounded-lg bg-white/5 p-3 text-xs text-ash">
          <b className="text-stone">Kontrol:</b> mouse = putar kamera &amp; bidik · WASD = melangkah · posisi terkunci
          otomatis saat waktu habis · F = tahan tembak · 1–4 = skill. Di HP: joystick = langkah, geser layar = bidik.
        </div>
        <button type="button" onClick={onClose} className="mt-4 w-full btn-gold py-2.5">
          SIAP!
        </button>
      </div>
    </div>
  );
}
