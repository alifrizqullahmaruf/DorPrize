import { describe, expect, it } from "vitest";
import { createGame, resolveRound, startRound, type EngineState } from "./engine";
import { dirFromVector, edgeFrom, maxSinkRings, pushInside, ringOf, shrinkRingFor } from "./geometry";
import { boardSizeFor } from "./rules";
import type { RoundSubmit } from "./protocol";

const rng = () => 0.42;
const idle: RoundSubmit = { moveTo: null, shootDir: null, skill: null, mineAt: null };

function game(n: number, spots: [number, number][], bid = 1): EngineState {
  const s = createGame(
    n,
    spots.map((_, i) => i + 1),
    bid,
    rng,
  );
  s.players.forEach((p, i) => {
    p.x = spots[i][0];
    p.y = spots[i][1];
  });
  return startRound(s);
}

const act = (a: Partial<RoundSubmit>): RoundSubmit => ({ ...idle, ...a });

describe("geometry", () => {
  it("computes rings and sink schedule", () => {
    expect(ringOf({ x: 0, y: 3 }, 8)).toBe(0);
    expect(ringOf({ x: 3, y: 4 }, 8)).toBe(3);
    expect(maxSinkRings(8)).toBe(3);
    expect(maxSinkRings(12)).toBe(5);
    expect(maxSinkRings(3)).toBe(0);
    // Round 1 is the full board; each later round removes one ring until 2×2.
    expect(shrinkRingFor(1, 8)).toBeNull();
    expect(shrinkRingFor(2, 8)).toBe(0);
    expect(shrinkRingFor(4, 8)).toBe(2);
    expect(shrinkRingFor(5, 8)).toBeNull();
    expect(shrinkRingFor(6, 12)).toBe(4);
    expect(shrinkRingFor(7, 12)).toBeNull();
  });
  it("sizes the board by player count", () => {
    expect([2, 3, 4, 6, 7, 10].map(boardSizeFor)).toEqual([8, 8, 10, 10, 12, 12]);
  });
  it("pushes tiles inside the remaining area", () => {
    expect(pushInside({ x: 0, y: 3 }, 8, 1)).toEqual({ x: 1, y: 3 });
    expect(pushInside({ x: 7, y: 0 }, 8, 2)).toEqual({ x: 5, y: 2 });
  });
  it("snaps vectors to 8 directions", () => {
    expect(dirFromVector(0, -1)).toBe("N");
    expect(dirFromVector(1, 1)).toBe("SE");
    expect(dirFromVector(-1, 0.1)).toBe("W");
  });
  it("finds the board edge", () => {
    expect(edgeFrom({ x: 2, y: 2 }, "W", 6)).toEqual({ x: 0, y: 2 });
    expect(edgeFrom({ x: 2, y: 3 }, "NE", 6)).toEqual({ x: 5, y: 0 });
  });
});

describe("resolveRound", () => {
  it("stops a shot at the first occupied tile", () => {
    const s = game(6, [
      [1, 2],
      [3, 2],
      [4, 2],
    ]);
    const r = resolveRound(s, { 1: act({ shootDir: "E" }) }, rng);
    expect(r.shared.deaths.map((d) => d.num)).toEqual([2]);
    expect(r.shared.shots[0].paths[0].to).toEqual({ x: 3, y: 2 });
    expect(r.shared.shots[0].paths[0].from).toEqual({ x: 1, y: 2 });
    expect(r.shared.revealed.map((p) => p.at)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);
  });

  it("fires from the destination tile after moving", () => {
    const s = game(6, [
      [1, 1],
      [3, 2],
    ]);
    const r = resolveRound(s, { 1: act({ moveTo: { x: 1, y: 2 }, shootDir: "E" }) }, rng);
    expect(r.shared.deaths.map((d) => d.num)).toEqual([2]);
  });

  it("hits players sharing the shooter tile", () => {
    const s = game(6, [
      [2, 2],
      [2, 2],
    ]);
    const r = resolveRound(s, { 1: act({ shootDir: "N" }) }, rng);
    expect(r.shared.deaths.map((d) => d.num)).toEqual([2]);
  });

  it("lets mutual kills both happen and splits the pot", () => {
    const s = game(4, [
      [1, 1],
      [2, 1],
    ]);
    const r = resolveRound(s, { 1: act({ shootDir: "E" }), 2: act({ shootDir: "W" }) }, rng);
    expect(r.shared.deaths).toHaveLength(2);
    expect(r.state.end?.reason).toBe("mutual");
    expect(r.state.end?.winners.sort()).toEqual([1, 2]);
    expect(r.state.players.every((p) => p.kills === 1)).toBe(true);
  });

  it("shielded players do not shoot", () => {
    const s = game(6, [
      [1, 2],
      [3, 2],
    ]);
    const r = resolveRound(s, { 1: act({ shootDir: "E", skill: "shield" }) }, rng);
    expect(r.shared.shots).toHaveLength(0);
    expect(r.shared.deaths).toHaveLength(0);
    expect(r.shared.revealed[0].facing).toBe("E");
  });

  it("blocks a frontal shot with the shield", () => {
    const s = game(6, [
      [1, 2],
      [3, 2],
    ]);
    const r = resolveRound(s, { 1: act({ shootDir: "E" }), 2: act({ shootDir: "W", skill: "shield" }) }, rng);
    // #2 only defends (no shot back), so nobody dies.
    expect(r.shared.deaths).toHaveLength(0);
    expect(r.shared.blocks).toEqual([{ num: 2, by: "shield", at: { x: 3, y: 2 }, dir: "W" }]);
  });

  it("does not block shots from behind with the shield", () => {
    const s = game(6, [
      [1, 2],
      [3, 2],
    ]);
    const r = resolveRound(s, { 1: act({ shootDir: "E" }), 2: act({ shootDir: "E", skill: "shield" }) }, rng);
    expect(r.shared.deaths.map((d) => d.num)).toEqual([2]);
  });

  it("absorbs one hit with the gold helm, which then breaks", () => {
    const s = game(6, [
      [1, 2],
      [3, 2],
    ]);
    const r = resolveRound(s, { 1: act({ shootDir: "E" }), 2: act({ skill: "goldHelm" }) }, rng);
    expect(r.shared.deaths).toHaveLength(0);
    expect(r.shared.blocks[0].by).toBe("helm");
    expect(r.state.players[1].helm).toBe(false);
    expect(r.state.players[1].fees).toBe(0.4);
  });

  it("shotgun hits three directions", () => {
    const s = game(6, [
      [2, 3],
      [2, 1],
      [0, 1],
      [4, 1],
    ]);
    const r = resolveRound(s, { 1: act({ shootDir: "N", skill: "shotgun" }) }, rng);
    expect(r.shared.deaths.map((d) => d.num).sort()).toEqual([2, 3, 4]);
    expect(r.state.players[0].kills).toBe(3);
  });

  it("drops the mine on the tile chosen when buying and explodes it on an opponent", () => {
    let s = game(6, [
      [2, 2],
      [3, 3],
    ]);
    let r = resolveRound(s, { 1: act({ skill: "mine", mineAt: { x: 2, y: 2 }, moveTo: { x: 2, y: 1 } }) }, rng);
    expect(r.state.mines).toEqual([{ owner: 1, x: 2, y: 2 }]);
    s = startRound(r.state);
    r = resolveRound(s, { 2: act({ moveTo: { x: 2, y: 2 } }) }, rng);
    expect(r.shared.mineBlasts).toHaveLength(1);
    expect(r.shared.deaths[0]).toMatchObject({ num: 2, cause: "mine", killerNums: [1] });
  });

  it("shrinks 8x8 -> 6x6 -> 4x4 -> 2x2 at round start and stops there", () => {
    let s = game(8, [
      [0, 0],
      [3, 3],
      [4, 4],
    ]);
    expect(s.sunkRings).toBe(0);
    for (const want of [1, 2, 3, 3, 3]) {
      s = startRound(resolveRound(s, {}, rng).state);
      expect(s.sunkRings).toBe(want);
    }
    expect(s.lastShrink).toBeNull();
  });

  it("pushes players on the sinking ring inwards instead of killing them", () => {
    let s = game(8, [
      [0, 0],
      [7, 4],
      [3, 3],
    ]);
    s = startRound(resolveRound(s, {}, rng).state);
    expect(s.players.every((p) => p.alive)).toBe(true);
    expect(s.players[0]).toMatchObject({ x: 1, y: 1 });
    expect(s.players[1]).toMatchObject({ x: 6, y: 4 });
    expect(s.lastShrink).toEqual({ ring: 0, pushed: [1, 2] });
  });

  it("destroys mines on the sinking ring without exploding", () => {
    let s = game(6, [
      [0, 2],
      [3, 3],
    ]);
    const r = resolveRound(s, { 1: act({ skill: "mine", moveTo: { x: 2, y: 2 } }) }, rng);
    expect(r.state.mines).toHaveLength(1);
    s = startRound(r.state);
    expect(s.mines).toHaveLength(0);
  });

  it("cannot walk into lava", () => {
    let s = game(6, [
      [1, 1],
      [3, 3],
    ]);
    s = { ...s, sunkRings: 1 };
    const r = resolveRound(s, { 1: act({ moveTo: { x: 0, y: 0 } }) }, rng);
    expect(r.state.players[0]).toMatchObject({ x: 1, y: 1 });
  });

  it("can walk to any solid tile in one round", () => {
    const s = game(6, [
      [1, 1],
      [5, 5],
    ]);
    const r = resolveRound(s, { 1: act({ moveTo: { x: 4, y: 3 } }) }, rng);
    expect(r.state.players[0]).toMatchObject({ x: 4, y: 3 });
  });

  it("respects cooldowns including the round of use (shield = 3 rounds)", () => {
    let s = game(6, [
      [2, 2],
      [3, 3],
    ]);
    let r = resolveRound(s, { 1: act({ skill: "shield" }) }, rng);
    s = startRound(r.state);
    expect(s.players[0].cooldowns.shield).toBe(2);
    r = resolveRound(s, { 1: act({ skill: "shield" }) }, rng);
    expect(r.state.players[0].fees).toBe(0.25);
    s = startRound(r.state);
    expect(s.players[0].cooldowns.shield).toBe(1);
    s = startRound(resolveRound(s, {}, rng).state);
    expect(s.players[0].cooldowns.shield).toBe(0);
  });

  it("gold helm is single use: absorbs a hit, then is gone", () => {
    let s = game(6, [
      [1, 2],
      [3, 2],
    ]);
    let r = resolveRound(s, { 2: act({ skill: "goldHelm" }) }, rng);
    expect(r.state.players[1].helm).toBe(true);
    s = startRound(r.state);
    r = resolveRound(s, { 1: act({ shootDir: "E" }) }, rng);
    expect(r.shared.blocks).toMatchObject([{ num: 2, by: "helm" }]);
    expect(r.shared.shots[0].paths[0].hitNums).toEqual([2]);
    expect(r.state.players[1]).toMatchObject({ helm: false, alive: true });
    s = startRound(r.state);
    r = resolveRound(s, { 1: act({ shootDir: "E" }) }, rng);
    expect(r.shared.deaths.map((d) => d.num)).toEqual([2]);
  });
});
