import test from "node:test";
import assert from "node:assert/strict";
import { createSiweMessage } from "viem/siwe";
import { parseMon, validateNativeChallenge } from "./validation";

const address = "0x50463168EBC5ae0Ed86efcA496b9A7A4495F7109";
const origin = "https://dorprize.vercel.app";
const now = Date.parse("2026-10-24T08:00:00Z");
const message = (changes: Record<string, unknown> = {}) =>
  createSiweMessage({
    address,
    chainId: 10143,
    domain: new URL(origin).host,
    uri: origin,
    version: "1",
    nonce: "12345678abcdef90",
    issuedAt: new Date(now - 60000),
    expirationTime: new Date(now + 300000),
    ...changes,
  });

test("MON amounts retain the complete 18-decimal value", () => {
  assert.equal(parseMon("1.000000000000000001"), 1000000000000000001n);
  assert.equal(parseMon("0.000000000000000001"), 1n);
});
test("zero is allowed only when explicitly selecting a zero skill budget", () => {
  assert.throws(() => parseMon("0"));
  assert.equal(parseMon("0", true), 0n);
});
test("ambiguous, rounded, exponent and negative amounts are rejected", () => {
  for (const value of ["", "1e3", "-1", "1.0000000000000000001", " 1", "1,5", "01", "1.", "NaN"])
    assert.throws(() => parseMon(value), value);
});
test("server SIWE challenge must bind the current wallet, testnet and browser origin", () => {
  assert.doesNotThrow(() =>
    validateNativeChallenge({ message: message(), expiresAt: now + 300000 }, address.toLowerCase(), origin, now),
  );
});
test("a different wallet cannot be signed in through a substituted challenge", () => {
  assert.throws(() =>
    validateNativeChallenge(
      { message: message({ address: "0xF262fd0A43B499389b5d6ef6153e2A710685349b" }), expiresAt: now + 300000 },
      address,
      origin,
      now,
    ),
  );
});
test("a challenge for mainnet is rejected", () => {
  assert.throws(() =>
    validateNativeChallenge({ message: message({ chainId: 143 }), expiresAt: now + 300000 }, address, origin, now),
  );
});
test("domain and URI are both verified before requesting the wallet signature", () => {
  for (const changes of [{ domain: "other.example" }, { uri: "https://other.example" }])
    assert.throws(() =>
      validateNativeChallenge({ message: message(changes), expiresAt: now + 300000 }, address, origin, now),
    );
});
test("both challenge metadata and signed-message expiry must still be valid", () => {
  assert.throws(() => validateNativeChallenge({ message: message(), expiresAt: now }, address, origin, now));
  assert.throws(() =>
    validateNativeChallenge(
      { message: message({ expirationTime: new Date(now - 1000) }), expiresAt: now + 300000 },
      address,
      origin,
      now,
    ),
  );
});
