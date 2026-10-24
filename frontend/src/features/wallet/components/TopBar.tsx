"use client";

import Link from "next/link";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { formatUsdc, NAME_MAX } from "@dorprize/game-core";
import { shortAddress, useAccountView } from "@/features/wallet/account";
import { useProfile } from "@/features/wallet/profile";
import { SkinPreview } from "@/features/game/three/SkinPreview";
import { CrownIcon, TrophyIcon, UsdcIcon } from "@/shared/ui/icons";
import { WalletModal, type WalletTab } from "@/features/wallet/components/WalletModal";

export function ProfileChip() {
  const p = useProfile(
    useShallow((s) => ({ name: s.name, skin: s.skin, trophies: s.trophies, crowns: s.crowns, setName: s.setName })),
  );
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 panel p-1 sm:p-1.5 pr-2.5 sm:pr-3 [@media(max-height:520px)]:py-1 [@media(max-height:520px)]:px-2">
      <Link
        href="/play"
        className="block overflow-hidden rounded-md bg-[#2a2622] px-1 pt-0.5 sm:px-1.5 sm:pt-1 [@media(max-height:520px)]:scale-90"
        title="Ganti skin"
      >
        <SkinPreview skin={p.skin} scale={1.2} />
      </Link>
      <div className="min-w-0">
        {editing ? (
          <input
            autoFocus
            defaultValue={p.name}
            maxLength={NAME_MAX}
            onBlur={(e) => {
              p.setName(e.target.value.trim());
              setEditing(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="w-28 sm:w-32 rounded bg-black/60 px-1 font-pixel text-xs sm:text-sm text-stone outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="max-w-24 truncate font-pixel text-xs text-stone sm:max-w-36 sm:text-sm [@media(max-height:520px)]:text-xs"
            title="Ubah nama"
          >
            {p.name} ✎
          </button>
        )}
        <div className="mt-0.5 flex items-center gap-2 sm:gap-3 font-pixel text-[11px] sm:text-xs [@media(max-height:520px)]:text-[10px]">
          <span className="flex items-center gap-1" title="Trofi = total kill">
            <TrophyIcon size={12} /> {p.trophies}
          </span>
          <span className="flex items-center gap-1" title="Mahkota = total menang">
            <CrownIcon size={12} /> {p.crowns}
          </span>
        </div>
      </div>
    </div>
  );
}

export function WalletChip() {
  const a = useAccountView();
  const [tab, setTab] = useState<WalletTab | null>(null);

  if (a.mode === "chain" && !a.connected) {
    return (
      <button
        type="button"
        onClick={a.connect}
        className="btn-gold px-3 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm"
      >
        {a.busy === "connect" ? "MEMBUKA…" : "CONNECT WALLET"}
      </button>
    );
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1 sm:gap-1.5 panel p-1.5 sm:p-2 [@media(max-height:520px)]:py-1 [@media(max-height:520px)]:px-2">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="flex items-center gap-1 font-pixel text-sm text-gold sm:text-lg [@media(max-height:520px)]:text-sm">
            <UsdcIcon size={16} />
            {formatUsdc(a.available)}
          </span>
          <button
            type="button"
            onClick={a.mode === "chain" ? a.disconnect : undefined}
            className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-ash sm:px-2 sm:text-[11px]"
            title={a.mode === "chain" ? "Putuskan wallet" : "Mode demo (tanpa wallet)"}
          >
            {a.mode === "demo" ? "DEMO" : shortAddress(a.address)}
          </button>
        </div>
        {a.locked > 0 && (
          <div className="text-[10px] text-ash sm:text-[11px]">Terkunci: {formatUsdc(a.locked)} USDC</div>
        )}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setTab("deposit")}
            className="btn-stone px-1.5 py-0.5 text-[9px] sm:px-2 sm:py-1 sm:text-[11px] [@media(max-height:520px)]:py-0.5 [@media(max-height:520px)]:px-1.5 [@media(max-height:520px)]:text-[9px]"
          >
            Deposit
          </button>
          <button
            type="button"
            onClick={() => setTab("withdraw")}
            className="btn-stone px-1.5 py-0.5 text-[9px] sm:px-2 sm:py-1 sm:text-[11px] [@media(max-height:520px)]:py-0.5 [@media(max-height:520px)]:px-1.5 [@media(max-height:520px)]:text-[9px]"
          >
            Tarik
          </button>
          <button
            type="button"
            onClick={() => setTab("faucet")}
            className="btn-gold px-1.5 py-0.5 text-[9px] sm:px-2 sm:py-1 sm:text-[11px] [@media(max-height:520px)]:py-0.5 [@media(max-height:520px)]:px-1.5 [@media(max-height:520px)]:text-[9px]"
          >
            Faucet
          </button>
        </div>
      </div>
      {tab && <WalletModal tab={tab} onTab={setTab} onClose={() => setTab(null)} />}
    </>
  );
}
