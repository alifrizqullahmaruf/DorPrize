"use client";

import Link from "next/link";
import { useState } from "react";
import { ProfileChip, WalletChip } from "@/features/wallet/components/TopBar";
import { MenuBackdrop } from "@/features/menu/MenuBackdrop";
import { Logo } from "@/shared/ui/Logo";

export function MainMenu() {
  const [help, setHelp] = useState(false);
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <div className="absolute inset-0">
        <MenuBackdrop />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.45),transparent_35%,transparent_65%,rgba(0,0,0,0.55))]" />

      <div className="relative z-10 flex h-full flex-col justify-between p-3 safe-inset sm:px-6 sm:py-5 [@media(max-height:520px)]:px-4 [@media(max-height:520px)]:py-2">
        <header className="flex shrink-0 items-start justify-between gap-2">
          <ProfileChip />
          <WalletChip />
        </header>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-1 sm:py-2">
          <Logo className="h-[min(26vh,140px)] w-[min(78vw,440px)] [@media(max-height:520px)]:h-[76px]" />
          <p className="mt-1 max-w-md text-center text-xs text-stone/90 [text-shadow:0_2px_0_#000] sm:text-sm [@media(max-height:520px)]:mt-0.5 [@media(max-height:520px)]:max-w-lg [@media(max-height:520px)]:text-[11px]">
            Tembak tanpa melihat lawan. Bertahan dari lava. Pemain terakhir mengambil seluruh pot.
          </p>
        </div>

        <footer className="flex shrink-0 items-end justify-between gap-3 pt-1 [@media(max-height:520px)]:pt-0">
          <button
            type="button"
            onClick={() => setHelp(true)}
            className="btn-stone px-3 py-2 text-xs sm:px-4 sm:py-3 sm:text-sm [@media(max-height:520px)]:px-3 [@media(max-height:520px)]:py-1.5 [@media(max-height:520px)]:text-xs"
          >
            CARA MAIN
          </button>
          <Link
            href="/play"
            className="btn-gold px-6 py-2.5 text-xl sm:px-12 sm:py-4 sm:text-2xl [@media(max-height:520px)]:px-6 [@media(max-height:520px)]:py-2 [@media(max-height:520px)]:text-lg [@media(min-height:600px)]:sm:py-5 [@media(min-height:600px)]:sm:text-3xl"
          >
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
    ["Masuk room", "Pilih room, kunci bid (min. 1 USDC). Pot = bid × jumlah pemain."],
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
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-3 safe-inset sm:p-4"
      onClick={onClose}
    >
      <div
        className="anim-pop max-h-[92dvh] w-full max-w-md overflow-y-auto panel p-4 sm:p-5 [@media(max-height:520px)]:p-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-pixel text-lg text-gold sm:text-xl">CARA MAIN</h2>
          <button type="button" onClick={onClose} className="btn-stone px-2 py-0.5 text-xs" aria-label="Tutup">
            ✕
          </button>
        </div>
        <ol className="mt-2.5 space-y-2 sm:space-y-3 [@media(max-height:520px)]:space-y-1.5">
          {steps.map(([t, d], i) => (
            <li key={t} className="flex gap-2.5 sm:gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded bg-gold font-pixel text-xs text-ink sm:size-7 sm:text-sm">
                {i + 1}
              </span>
              <div>
                <div className="font-pixel text-xs text-stone sm:text-sm">{t}</div>
                <div className="text-xs text-ash sm:text-sm">{d}</div>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-3 rounded-lg bg-white/5 p-2.5 text-[11px] text-ash sm:text-xs">
          <b className="text-stone">Kontrol:</b> mouse = putar kamera &amp; bidik · WASD = melangkah · posisi terkunci
          otomatis saat waktu habis · F = tahan tembak · 1–4 = skill. Di HP: joystick = langkah, geser layar = bidik.
        </div>
        <button type="button" onClick={onClose} className="mt-3 w-full btn-gold py-2 text-sm sm:py-2.5 sm:text-base">
          SIAP!
        </button>
      </div>
    </div>
  );
}
