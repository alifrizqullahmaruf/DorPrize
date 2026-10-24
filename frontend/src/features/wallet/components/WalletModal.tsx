"use client";

import { useAccountView, shortAddress, DEMO_FAUCET_AMOUNT } from "@/features/wallet/account";
import { UsdcIcon } from "@/shared/ui/icons";
import { ASSET_SYMBOL, NATIVE_MODE } from "@/shared/backend/native";

export type WalletTab = "deposit" | "withdraw" | "faucet";

export function WalletModal({
  tab,
  onTab,
  onClose,
}: {
  tab: WalletTab;
  onTab: (t: WalletTab) => void;
  onClose: () => void;
}) {
  const a = useAccountView();
  const withdrawBlocked = !NATIVE_MODE && a.locked > 0;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="anim-pop w-full max-w-sm panel p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Dompet"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-pixel text-xl text-gold">DOMPET</h2>
          <button type="button" onClick={onClose} className="btn-stone px-2.5 py-1 text-sm" aria-label="Tutup">
            ✕
          </button>
        </div>
        <div className="mt-1 text-xs text-ash">
          {a.mode === "demo"
            ? "Mode demo: saldo USDC testnet tiruan disimpan di browser."
            : `Vault ${NATIVE_MODE ? "NativeGameVault" : "GameVault"} · ${shortAddress(a.address)}`}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-white/5 p-3">
            <div className="text-[11px] text-ash">Tersedia</div>
            <div className="flex items-center gap-1 font-pixel text-lg text-gold">
              <UsdcIcon size={16} />
              {a.availableDisplay}
            </div>
          </div>
          <div className="rounded-lg bg-white/5 p-3">
            <div className="text-[11px] text-ash">Terkunci di room</div>
            <div className="font-pixel text-lg">{a.lockedDisplay}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-black/40 p-1">
          {(["deposit", "withdraw", "faucet"] as WalletTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTab(t)}
              className={`rounded-md py-1.5 font-pixel text-xs ${tab === t ? "bg-gold text-ink" : "text-stone hover:bg-white/5"}`}
            >
              {t === "deposit" ? "Deposit" : t === "withdraw" ? "Tarik" : "Faucet"}
            </button>
          ))}
        </div>

        {tab === "faucet" ? (
          <div className="mt-4">
            <p className="text-sm text-ash">
              Klaim {ASSET_SYMBOL} testnet gratis{a.mode === "demo" ? ` (+${DEMO_FAUCET_AMOUNT} USDC)` : ""}. Di mode
              on-chain, hasil faucet masuk ke wallet; lalu deposit ke Vault untuk bermain.
            </p>
            <button
              type="button"
              onClick={a.onFaucet}
              disabled={a.busy === "faucet"}
              className="mt-3 w-full btn-gold py-3"
            >
              {a.busy === "faucet" ? "MENGKLAIM…" : "KLAIM FAUCET"}
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <label className="text-xs text-ash" htmlFor="amt">
              Jumlah {ASSET_SYMBOL}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="amt"
                inputMode="decimal"
                value={a.amount}
                onChange={(e) => a.setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className="w-full rounded-md border-2 border-white/10 bg-black/60 px-3 py-2 font-pixel text-lg text-stone outline-none focus:border-gold"
              />
              {tab === "withdraw" && (
                <button
                  type="button"
                  onClick={() => a.setAmount(String(a.available))}
                  className="btn-stone px-3 text-xs"
                >
                  MAX
                </button>
              )}
            </div>
            {a.mode === "chain" && tab === "deposit" && (
              <div className="mt-1 text-[11px] text-ash">
                Saldo wallet: {a.walletDisplay} {ASSET_SYMBOL}
              </div>
            )}
            {tab === "withdraw" && withdrawBlocked && (
              <div className="mt-2 text-xs text-danger">Tarik diblokir selama kamu punya room aktif.</div>
            )}
            <button
              type="button"
              onClick={tab === "deposit" ? a.onDeposit : a.onWithdraw}
              disabled={a.busy !== "" || (tab === "withdraw" && withdrawBlocked)}
              className="mt-3 w-full btn-gold py-3"
            >
              {a.busy === tab ? "MEMPROSES…" : tab === "deposit" ? "DEPOSIT KE VAULT" : "TARIK SALDO"}
            </button>
          </div>
        )}

        {a.needsChainSwitch && (
          <button type="button" onClick={a.switchChain} className="mt-3 w-full btn-stone py-2 text-xs">
            Pindah ke Monad Testnet
          </button>
        )}
        {a.status && <div className="mt-3 text-xs text-gold">{a.status}</div>}
        {a.error && <div className="mt-2 text-xs text-danger">{a.error}</div>}
      </div>
    </div>
  );
}
