"use client";

import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { appKitMetadata, appKitNetworks, monadWagmiChain, projectId } from "@/features/wallet/web3/wagmiConfig";

export const wagmiAdapter = new WagmiAdapter({
  networks: appKitNetworks,
  projectId,
  ssr: true,
});

type AppKitRuntimeWindow = typeof globalThis & {
  __DORPRIZE_APPKIT_INITIALIZED__?: boolean;
};

const appKitWindow = globalThis as AppKitRuntimeWindow;

function initializeAppKit() {
  if (appKitWindow.__DORPRIZE_APPKIT_INITIALIZED__) {
    return;
  }

  createAppKit({
    adapters: [wagmiAdapter],
    networks: appKitNetworks,
    defaultNetwork: monadWagmiChain,
    projectId,
    metadata: appKitMetadata,
  });
  appKitWindow.__DORPRIZE_APPKIT_INITIALIZED__ = true;
}

export async function ensureAppKitInitialized() {
  initializeAppKit();
}
