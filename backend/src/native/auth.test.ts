import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { WalletAuth } from "./auth";
import { parseWei } from "./service";
import { loadNativeConfig } from "./config";

// Public local development key. Never funded on a live network by these tests.
const alice = privateKeyToAccount(`0x${"01".padStart(64, "0")}`);
const bob = privateKeyToAccount(`0x${"02".padStart(64, "0")}`);
const make = (now?: () => number) =>
  new WalletAuth(
    "https://dorprize.vercel.app",
    10143,
    (message, signature) => verifyMessage({ address: alice.address, message, signature }),
    now,
  );

describe("native backend auth and amount validation", () => {
  it("binds login to a server message and rejects replay including parallel requests", async () => {
    const auth = make();
    const challenge = auth.challenge(alice.address);
    expect(challenge.message).toContain("dorprize.vercel.app");
    expect(challenge.message).toContain("Chain ID: 10143");
    const signature = await alice.signMessage({ message: challenge.message });
    const logins = await Promise.allSettled([
      auth.login(challenge.challengeId, signature),
      auth.login(challenge.challengeId, signature),
    ]);
    expect(logins.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const result = logins.find((r) => r.status === "fulfilled")! as PromiseFulfilledResult<
      Awaited<ReturnType<WalletAuth["login"]>>
    >;
    expect(auth.session(result.value.token)?.address).toBe(alice.address);
    auth.logout(result.value.token);
    expect(auth.session(result.value.token)).toBeUndefined();
  });
  it("rejects another signer and consumes rejected challenges", async () => {
    const auth = make();
    const challenge = auth.challenge(alice.address);
    await expect(
      auth.login(challenge.challengeId, await bob.signMessage({ message: challenge.message })),
    ).rejects.toThrow("rejected");
    await expect(
      auth.login(challenge.challengeId, await alice.signMessage({ message: challenge.message })),
    ).rejects.toThrow("used");
  });
  it("expires challenges and sessions", async () => {
    let now = Date.now();
    const auth = make(() => now);
    const expired = auth.challenge(alice.address);
    now += 300_000;
    await expect(
      auth.login(expired.challengeId, await alice.signMessage({ message: expired.message })),
    ).rejects.toThrow("expired");
    const current = auth.challenge(alice.address);
    const login = await auth.login(current.challengeId, await alice.signMessage({ message: current.message }));
    now += 3_600_000;
    expect(auth.session(login.token)).toBeUndefined();
  });
  it("accepts only exact uint256 wei strings, including sub-cent amounts", () => {
    expect(parseWei("1000000000000000001", 10n ** 18n)).toBe(1000000000000000001n);
    for (const value of [1, 1.1, "1.1", "1e18", "-1", "01", "", (2n ** 256n).toString(), null])
      expect(() => parseWei(value)).toThrow();
  });
  it("rejects mainnet, remote local-chain URLs and missing persistence", () => {
    expect(() => loadNativeConfig({ CHAIN_ID: "143", MONAD_RPC_URL: "https://example.com" })).toThrow("Only Monad");
    expect(() =>
      loadNativeConfig({ CHAIN_ID: "31337", NATIVE_ALLOW_LOCAL: "1", MONAD_RPC_URL: "https://example.com" }),
    ).toThrow("Only Monad");
    expect(() =>
      loadNativeConfig({
        MONAD_RPC_URL: "https://example.com",
        NATIVE_GAME_VAULT_ADDRESS: alice.address,
        OPERATOR_PRIVATE_KEY: `0x${"01".padStart(64, "0")}`,
        BACKEND_SIGNER_PRIVATE_KEY: `0x${"02".padStart(64, "0")}`,
      }),
    ).toThrow("durable");
  });
});
