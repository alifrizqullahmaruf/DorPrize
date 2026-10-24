"use client";

import { create } from "zustand";
import { DEFAULT_NAME, NAME_MAX, roundCents, SKIN_IDS } from "@dorprize/game-core";

/**
 * Local player profile + demo wallet. In offline/demo mode this is the whole
 * "chain": balances move here instead of the GameVault contract.
 */
type ProfileState = {
  name: string;
  skin: string;
  trophies: number;
  crowns: number;
  demoAvailable: number;
  demoLocked: number;
  hydrated: boolean;
  hydrate: () => void;
  setName: (name: string) => void;
  setSkin: (skin: string) => void;
  addStats: (kills: number, won: boolean) => void;
  demoFaucet: (amount: number) => void;
  demoDeposit: (amount: number) => void;
  demoWithdraw: (amount: number) => void;
  demoLock: (amount: number) => void;
  demoUnlock: (amount: number) => void;
  demoSettle: (bid: number, payout: number, fees: number) => void;
};

const KEY = "dorprize.profile.v1";

type Persisted = Pick<ProfileState, "name" | "skin" | "trophies" | "crowns" | "demoAvailable" | "demoLocked">;

function save(s: Persisted) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage blocked: profile simply won't persist
  }
}

export const useProfile = create<ProfileState>((set, get) => {
  const persist = () => {
    const { name, skin, trophies, crowns, demoAvailable, demoLocked } = get();
    save({ name, skin, trophies, crowns, demoAvailable, demoLocked });
  };
  const update = (patch: Partial<ProfileState>) => {
    set(patch);
    persist();
  };
  return {
    name: DEFAULT_NAME,
    skin: SKIN_IDS[0],
    trophies: 0,
    crowns: 0,
    demoAvailable: 0,
    demoLocked: 0,
    hydrated: false,
    hydrate: () => {
      if (get().hydrated) return;
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const data = JSON.parse(raw) as Partial<Persisted>;
          // Any bid still locked from an interrupted game goes back to available.
          const available = roundCents((data.demoAvailable ?? 0) + (data.demoLocked ?? 0));
          set({ ...data, demoAvailable: available, demoLocked: 0 });
        } else {
          set({ name: `${DEFAULT_NAME}${Math.floor(100 + Math.random() * 900)}` });
        }
      } catch {
        // ignore
      }
      set({ hydrated: true });
      persist();
    },
    setName: (name) => update({ name: name.slice(0, NAME_MAX) || DEFAULT_NAME }),
    setSkin: (skin) => update({ skin }),
    addStats: (kills, won) => update({ trophies: get().trophies + kills, crowns: get().crowns + (won ? 1 : 0) }),
    demoFaucet: (amount) => update({ demoAvailable: roundCents(get().demoAvailable + amount) }),
    demoDeposit: (amount) => update({ demoAvailable: roundCents(get().demoAvailable + amount) }),
    demoWithdraw: (amount) => update({ demoAvailable: roundCents(Math.max(0, get().demoAvailable - amount)) }),
    demoLock: (amount) =>
      update({
        demoAvailable: roundCents(get().demoAvailable - amount),
        demoLocked: roundCents(get().demoLocked + amount),
      }),
    demoUnlock: (amount) =>
      update({
        demoAvailable: roundCents(get().demoAvailable + amount),
        demoLocked: roundCents(Math.max(0, get().demoLocked - amount)),
      }),
    demoSettle: (bid, payout, fees) =>
      update({
        demoLocked: roundCents(Math.max(0, get().demoLocked - bid)),
        demoAvailable: roundCents(get().demoAvailable + payout - fees),
      }),
  };
});
