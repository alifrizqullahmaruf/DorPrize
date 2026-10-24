import assert from "node:assert/strict";
import { test } from "node:test";
import { hashTypedData, parseEther, toHex } from "viem";
import { nativeJoinTypedData, nativePayout, nativeSkillPrice, MON_CENT } from "../native";

test("skill prices match the 1/2/5/10 MON product matrix", () => {
  for (const [bid, expected] of [
    ["1", ["0.15", "0.25", "0.25", "0.4"]],
    ["2", ["0.3", "0.5", "0.5", "0.8"]],
    ["5", ["0.75", "1.25", "1.25", "2"]],
    ["10", ["1.5", "2.5", "2.5", "4"]],
  ] as const) {
    const skills = ["mine", "shotgun", "shield", "helmet"] as const;
    skills.forEach((skill, i) => assert.equal(nativeSkillPrice(parseEther(bid), skill), parseEther(expected[i])));
  }
});

test("custom bids use half-up cent rounding, including exactly half a cent", () => {
  assert.equal(nativeSkillPrice(parseEther("1.02"), "shotgun"), parseEther("0.26"));
  assert.equal(nativeSkillPrice(parseEther("1.03"), "mine"), parseEther("0.15"));
  assert.equal(nativeSkillPrice(parseEther("1.05"), "mine"), parseEther("0.16"));
});

test("10 MON pot with three winners credits 3.33 each and separates 0.01 dust", () => {
  assert.deepEqual(nativePayout(parseEther("2.5"), 4, 3), {
    potWei: parseEther("10"),
    payoutEachWei: parseEther("3.33"),
    dustWei: MON_CENT,
  });
});

test("a single winner receives all sub-cent wei instead of a second refund", () => {
  const bid = parseEther("1") + 1n;
  assert.deepEqual(nativePayout(bid, 2, 1), { potWei: 2n * bid, payoutEachWei: 2n * bid, dustWei: 0n });
});

test("invalid room and settlement counts are rejected", () => {
  for (const [players, winners] of [
    [1, 1],
    [11, 1],
    [3, 0],
    [3, 4],
    [2.5, 1],
    [3, 1.5],
  ]) {
    assert.throws(() => nativePayout(parseEther("1"), players, winners), RangeError);
  }
  assert.throws(() => nativeSkillPrice(parseEther("0.99"), "mine"), RangeError);
});

test("viem typed data changes for chain, vault, budget, nonce and player", () => {
  const address = "0x1111111111111111111111111111111111111111" as const;
  const other = "0x2222222222222222222222222222222222222222" as const;
  const ticket = { roomId: toHex(1n, { size: 32 }), player: address, skillBudgetWei: 1n, nonce: 0n, deadline: 100n };
  const hash = hashTypedData(nativeJoinTypedData(address, ticket));
  for (const typed of [
    nativeJoinTypedData(address, ticket, 31337),
    nativeJoinTypedData(other, ticket),
    nativeJoinTypedData(address, { ...ticket, skillBudgetWei: 2n }),
    nativeJoinTypedData(address, { ...ticket, nonce: 1n }),
    nativeJoinTypedData(address, { ...ticket, player: other }),
  ])
    assert.notEqual(hashTypedData(typed), hash);
});
