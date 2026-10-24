"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { IS_DEMO } from "@/features/wallet/account";
import { useProfile } from "@/features/wallet/profile";
import { WalletProvider } from "@/features/wallet/web3/WalletProvider";
import { Web3Provider } from "@/features/wallet/web3/Web3Provider";

function ProfileHydrator() {
  const hydrate = useProfile((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  if (IS_DEMO) {
    return (
      <>
        <ProfileHydrator />
        {children}
      </>
    );
  }
  return (
    <Web3Provider>
      <WalletProvider>
        <ProfileHydrator />
        {children}
      </WalletProvider>
    </Web3Provider>
  );
}
