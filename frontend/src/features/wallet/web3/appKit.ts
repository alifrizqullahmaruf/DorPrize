"use client";

import type { createAppKit } from "@reown/appkit/react";
import { appKitMetadata, appKitNetworks, monadWagmiChain, projectId } from "@/features/wallet/web3/wagmiConfig";
import { createConfig, http, type Config } from "wagmi";
import { injected } from "@wagmi/core";

export const wagmiAdapter: { wagmiConfig: Config } = {
  wagmiConfig: createConfig({
    chains: [monadWagmiChain],
    connectors: [injected({ target: "metaMask" })],
    transports: { [monadWagmiChain.id]: http(monadWagmiChain.rpcUrls.default.http[0]) },
    ssr: true,
  }),
};

type AppKitRuntimeWindow = typeof globalThis & {
  __DORPRIZE_APPKIT_INITIALIZED__?: boolean;
  __DORPRIZE_APPKIT__?: ReturnType<typeof createAppKit>;
  __DORPRIZE_APPKIT_CONFIG__?: Config;
};

const appKitWindow = globalThis as AppKitRuntimeWindow;

let initialization: Promise<void> | undefined;

async function initializeAppKit() {
  // Keep the legacy wallet SDK out of native builds; MetaMask uses injected wagmi.
  if (process.env.NEXT_PUBLIC_ASSET_MODE !== "native") {
    if (appKitWindow.__DORPRIZE_APPKIT_INITIALIZED__) {
      wagmiAdapter.wagmiConfig = appKitWindow.__DORPRIZE_APPKIT_CONFIG__!;
      return;
    }

    const [{ createAppKit }, { WagmiAdapter }] = await Promise.all([
      import("@reown/appkit/react"),
      import("@reown/appkit-adapter-wagmi"),
    ]);
    const legacyAdapter = new WagmiAdapter({ networks: appKitNetworks, projectId, ssr: true });
    wagmiAdapter.wagmiConfig = legacyAdapter.wagmiConfig;
    appKitWindow.__DORPRIZE_APPKIT__ = createAppKit({
      adapters: [legacyAdapter],
      networks: appKitNetworks,
      defaultNetwork: monadWagmiChain,
      projectId,
      metadata: appKitMetadata,
    });
    appKitWindow.__DORPRIZE_APPKIT_CONFIG__ = legacyAdapter.wagmiConfig;
    appKitWindow.__DORPRIZE_APPKIT_INITIALIZED__ = true;
  }
}

export async function ensureAppKitInitialized() {
  initialization ??= initializeAppKit().catch((error) => {
    initialization = undefined;
    throw error;
  });
  await initialization;
}

export async function openLegacyWallet() {
  await ensureAppKitInitialized();
  await appKitWindow.__DORPRIZE_APPKIT__?.open();
}
