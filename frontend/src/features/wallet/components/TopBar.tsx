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
import { ASSET_SYMBOL, NATIVE_MODE } from "@/shared/backend/native";
import { useWallet } from "@/features/wallet/web3/WalletProvider";

export function ProfileChip() {
  const p = useProfile(
    useShallow((s) => ({ name: s.name, skin: s.skin, trophies: s.trophies, crowns: s.crowns, setName: s.setName })),
  );
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex items-center gap-2 panel p-1.5 pr-3">
      <Link href="/play" className="block overflow-hidden rounded-md bg-[#2a2622] px-1.5 pt-1" title="Ganti skin">
        <SkinPreview skin={p.skin} scale={1.3} />
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
            className="w-32 rounded bg-black/60 px-1 font-pixel text-sm text-stone outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="max-w-24 truncate font-pixel text-xs text-stone sm:max-w-36 sm:text-sm"
            title="Ubah nama"
          >
            {p.name} ✎
          </button>
        )}
        <div className="mt-0.5 flex items-center gap-3 font-pixel text-xs">
          <span className="flex items-center gap-1" title="Trofi = total kill">
            <TrophyIcon size={14} /> {p.trophies}
          </span>
          <span className="flex items-center gap-1" title="Mahkota = total menang">
            <CrownIcon size={14} /> {p.crowns}
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
      <button type="button" onClick={a.connect} className="btn-gold px-4 py-2 text-sm">
        {a.busy === "connect" ? "MEMBUKA…" : "CONNECT WALLET"}
      </button>
    );
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1.5 panel p-2">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 font-pixel text-base text-gold sm:text-lg">
            <UsdcIcon size={18} />
            {formatUsdc(a.available)}
          </span>
          <button
            type="button"
            onClick={a.mode === "chain" ? a.disconnect : undefined}
            className="rounded bg-white/10 px-2 py-0.5 font-mono text-[11px] text-ash"
            title={a.mode === "chain" ? "Putuskan wallet" : "Mode demo (tanpa wallet)"}
          >
            {a.mode === "demo" ? "DEMO" : shortAddress(a.address)}
          </button>
        </div>
        {a.locked > 0 && (
          <div className="text-[11px] text-ash">
            Terkunci: {a.lockedDisplay} {ASSET_SYMBOL}
          </div>
        )}
        <div className="flex gap-1">
          {NATIVE_MODE && <NativeLoginButton />}
          <button
            type="button"
            onClick={() => setTab("deposit")}
            className="btn-stone px-1.5 py-1 text-[10px] sm:px-2 sm:text-[11px]"
          >
            Deposit
          </button>
          <button
            type="button"
            onClick={() => setTab("withdraw")}
            className="btn-stone px-1.5 py-1 text-[10px] sm:px-2 sm:text-[11px]"
          >
            Tarik
          </button>
          <button
            type="button"
            onClick={() => setTab("faucet")}
            className="btn-gold px-1.5 py-1 text-[10px] sm:px-2 sm:text-[11px]"
          >
            Faucet
          </button>
        </div>
      </div>
      {tab && <WalletModal tab={tab} onTab={setTab} onClose={() => setTab(null)} />}
    </>
  );
}

function NativeLoginButton() {
  const wallet = useWallet();
  if (wallet.isBackendAuthenticated) return null;
  return (
    <button
      type="button"
      disabled={wallet.isBackendAuthLoading}
      onClick={() => void (wallet.isMonadChain ? wallet.ensureBackendSession() : wallet.switchToMonad())}
      className="btn-stone px-2 py-1 text-[10px]"
    >
      {wallet.isBackendAuthLoading ? "LOGIN…" : wallet.isMonadChain ? "LOGIN GAME" : "PINDAH JARINGAN"}
    </button>
  );
}
