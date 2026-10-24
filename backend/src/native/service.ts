import { randomUUID } from "node:crypto";
import { formatEther, keccak256, toHex, zeroHash, type Address, type Hex } from "viem";
import {
  RoomRunner,
  canUseSkill,
  isSolid,
  makeRoomId,
  type RoundSubmit,
  type SendFn,
  type Skill,
} from "@dorprize/game-core";
import { nativePayout, nativeRosterHash, nativeSkillPrice } from "@dorprize/contracts/native";
import { NativeChain } from "./chain";
import type { Journal } from "./store";
import type { ServerConfig } from "../config";

export type RosterEntry = { address: Address; num: number; budgetWei: string };
export type NativeResult = {
  chainId: number;
  vault: Address;
  matchId: string;
  roomId: Hex;
  recipients: Address[];
  amountsWei: string[];
  skillFeesWei: string[];
  rosterHash: Hex;
  potWei: string;
  dustWei: string;
  reason: string;
  round: number;
  kills: Record<number, number>;
  resultHash: Hex;
};
export type MatchRecord = {
  code: string;
  matchId: string;
  roomId: Hex;
  name: string;
  bidWei: string;
  maxPlayers: number;
  isPrivate: boolean;
  creator: Address;
  joinDeadline: string;
  status: "creating" | "waiting" | "starting" | "active" | "result" | "settled" | "recovery" | "cancelled";
  roster: RosterEntry[];
  feesWei: Record<string, string>;
  result?: NativeResult;
  settlementTx?: Hex;
  recoveryTx?: Hex;
  /** Server-only audit trail, never included in lobby/round-input payloads. */
  audit?: { round: number; state: unknown; actions: unknown; resolve: unknown; feesWei: Record<string, string> }[];
};
const playerKey = (address: string) => address.toLowerCase();
const uint = (value: unknown) =>
  typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
export function parseWei(value: unknown, minimum = 0n): bigint {
  if (!uint(value) || BigInt(value as string) < minimum)
    throw new Error("Amounts must be unsigned integer wei strings");
  return BigInt(value as string);
}

export class NativeService {
  readonly rooms = new Map<string, RoomRunner>();
  private records = new Map<string, MatchRecord>();
  private locks = new Map<string, Promise<unknown>>();
  private busyWorker = false;
  private stopped = false;
  constructor(
    readonly chain: NativeChain,
    readonly store: Journal,
    private config: ServerConfig,
    private send: SendFn,
    private notify: (players: Address[], payload: { roomId: string; status: string; txHash?: Hex }) => void,
    private report: (error: unknown) => void = () =>
      console.error("Native backend operation failed; inspect persisted state and chain receipts."),
  ) {
    if (config.allowBots) throw new Error("Bots are forbidden for native escrow matches");
  }

  async initialize() {
    await this.chain.initialize();
    for (const record of await this.store.list<MatchRecord>("match:")) {
      // Memory-only active rounds cannot be safely resumed after a restart.
      if (!["settled", "cancelled", "result"].includes(record.status)) {
        record.status = "recovery";
        await this.save(record);
      }
      this.records.set(record.code, record);
    }
    await this.work();
  }

  private save(record: MatchRecord) {
    return this.store.put(`match:${record.code}`, record);
  }
  locked<T>(code: string, fn: () => Promise<T>): Promise<T> {
    if (this.stopped) return Promise.reject(new Error("Native service is stopping"));
    const previous = this.locks.get(code) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(fn);
    this.locks.set(code, current);
    void current
      .finally(() => {
        if (this.locks.get(code) === current) this.locks.delete(code);
      })
      .catch(() => {});
    return current;
  }
  private record(code: string) {
    const record = this.records.get(code);
    if (!record) throw new Error("Room not found");
    return record;
  }
  list() {
    return [...this.records.values()]
      .filter((r) => !r.isPrivate && r.status === "waiting")
      .map((r) => this.publicInfo(r));
  }
  info(code: string) {
    return this.publicInfo(this.record(code));
  }
  private publicInfo(r: MatchRecord) {
    return {
      roomId: r.code,
      matchId: r.matchId,
      escrowRoomId: r.roomId,
      bidWei: r.bidWei,
      asset: "MON",
      decimals: 18,
      name: r.name,
      maxPlayers: r.maxPlayers,
      isPrivate: r.isPrivate,
      status: r.status,
      joinDeadline: r.joinDeadline,
      players: this.rooms.get(r.code)?.humans.length ?? r.roster.length,
      chainId: this.chain.config.chainId,
      vault: this.chain.config.vault,
    };
  }

  async create(creator: Address, body: Record<string, unknown>) {
    return this.locked("$create", async () => {
      const bid = parseWei(body.bidWei, 10n ** 18n);
      if (bid > 1_000_000n * 10n ** 18n) throw new Error("Bid exceeds backend limit");
      const max = body.maxPlayers;
      if (typeof max !== "number" || !Number.isInteger(max) || max < 2 || max > 10)
        throw new Error("Capacity must be 2–10");
      const open = [...this.records.values()].filter((r) => !["settled", "cancelled"].includes(r.status));
      if (open.length >= 100 || open.filter((r) => r.creator === creator).length >= 3)
        throw new Error("Too many open rooms");
      let code = makeRoomId();
      while (this.records.has(code)) code = makeRoomId();
      const matchId = randomUUID();
      const r: MatchRecord = {
        code,
        matchId,
        roomId: keccak256(toHex(matchId)),
        name: typeof body.name === "string" ? body.name.trim().slice(0, 24) || "Room" : "Room",
        bidWei: bid.toString(),
        maxPlayers: max,
        isPrivate: body.isPrivate === true,
        creator,
        joinDeadline: ((await this.chain.timestamp()) + 600n).toString(),
        status: "creating",
        roster: [],
        feesWei: {},
      };
      this.records.set(code, r);
      await this.save(r);
      try {
        await this.chain.write(`create:${r.matchId}`, "createRoom", [r.roomId, bid, max, BigInt(r.joinDeadline)]);
        r.status = "waiting";
        await this.save(r);
        this.makeRunner(r);
        return this.publicInfo(r);
      } catch (error) {
        r.status = "recovery";
        await this.save(r);
        throw error;
      }
    });
  }

  async ticket(code: string, address: Address, budget: unknown) {
    return this.locked(code, async () => {
      const r = this.record(code);
      if (r.status !== "waiting" || this.rooms.get(code)?.status !== "LOBBY")
        throw new Error("Room is not accepting tickets");
      const skillBudgetWei = parseWei(budget);
      const room = await this.chain.room(r.roomId);
      const now = await this.chain.timestamp();
      if (room.status !== 1 || now >= room.joinDeadline || room.players.length >= room.maxPlayers)
        throw new Error("Onchain room closed or full");
      const [nonce, available, active] = await Promise.all([
        this.chain.read<bigint>("nonces", [address]),
        this.chain.read<bigint>("availableBalanceOf", [address]),
        this.chain.read<Hex>("activeRoomOf", [address]),
      ]);
      if (active !== zeroHash || available < room.bidWei + skillBudgetWei)
        throw new Error("Wallet already active or available balance insufficient");
      const ticket = {
        roomId: r.roomId,
        player: address,
        skillBudgetWei,
        nonce,
        deadline: now + 120n < room.joinDeadline ? now + 120n : room.joinDeadline - 1n,
      };
      return {
        ticket: {
          ...ticket,
          skillBudgetWei: skillBudgetWei.toString(),
          nonce: nonce.toString(),
          deadline: ticket.deadline.toString(),
        },
        signature: await this.chain.sign(ticket),
        chainId: this.chain.config.chainId,
        vault: this.chain.config.vault,
      };
    });
  }

  async join(code: string, address: Address, name: string, skin: string) {
    return this.locked(code, async () => {
      const r = this.record(code);
      const runner = this.rooms.get(code);
      if (!runner || !["waiting", "active", "result", "settled"].includes(r.status))
        throw new Error("Room is recovering; check result/refund status");
      const existing = runner.seatOf(playerKey(address));
      if (r.status === "waiting") {
        const room = await this.chain.room(r.roomId);
        const entry = await this.chain.entry(r.roomId, address);
        if (room.status !== 1 || !entry.joined || !room.players.some((p) => playerKey(p) === playerKey(address)))
          throw new Error("Confirmed native escrow membership required");
      } else if (!existing || !r.roster.some((p) => playerKey(p.address) === playerKey(address)))
        throw new Error("Wallet is not in the frozen roster");
      const result = runner.join(playerKey(address), name, skin);
      if (!result.ok) throw new Error(result.error);
      return runner;
    });
  }

  async ready(code: string, address: Address, ready: boolean) {
    return this.locked(code, async () => {
      const r = this.record(code);
      const runner = this.rooms.get(code);
      if (!runner || r.status !== "waiting" || runner.startPending)
        throw new Error("Start is processing or room closed");
      if (!runner.seatOf(playerKey(address))) throw new Error("Join the room first");
      const entry = await this.chain.entry(r.roomId, address);
      if (!entry.joined) throw new Error("Escrow membership no longer valid");
      runner.setReady(playerKey(address), ready);
    });
  }

  async leave(code: string, address: Address) {
    return this.locked(code, async () => {
      const r = this.record(code);
      const runner = this.rooms.get(code);
      if (!runner) return;
      if (runner.startPending || r.status === "starting") throw new Error("Start confirmation is pending");
      if (r.status === "waiting") {
        const room = await this.chain.room(r.roomId);
        const entry = await this.chain.entry(r.roomId, address);
        if (room.status !== 1 || entry.joined)
          throw new Error("Confirm leaveRoom transaction in MetaMask before leaving lobby");
        runner.leave(playerKey(address));
      } else {
        // Departures keep their roster membership and use default actions; never
        // forfeit an escrow player and accidentally produce an empty winner list.
        runner.disconnect(playerKey(address));
      }
    });
  }

  private makeRunner(r: MatchRecord) {
    const runner: RoomRunner = new RoomRunner({
      roomId: r.code,
      name: r.name,
      bid: Number(formatEther(BigInt(r.bidWei))),
      maxPlayers: r.maxPlayers,
      isPrivate: r.isPrivate,
      timeScale: this.config.timeScale,
      send: this.send,
      targetBots: 0,
      strictDeadline: true,
      preserveLobbyOnDisconnect: true,
      beforeStart: () => this.locked(r.code, () => this.start(r, runner)),
      validateAction: (room, id, action) => this.validateAction(r, room, id, action),
      onResolved: (room, used, shared, actions) => {
        for (const [num, skill] of Object.entries(used)) {
          const entry = r.roster.find((p) => p.num === Number(num))!;
          const key = playerKey(entry.address);
          r.feesWei[key] = (BigInt(r.feesWei[key] ?? "0") + this.price(r, skill)).toString();
        }
        // Legacy numeric values remain display-only; native settlement uses the ledger above.
        for (const p of room.engine?.players ?? []) {
          const entry = r.roster.find((s) => s.num === p.num)!;
          p.fees = Number(formatEther(BigInt(r.feesWei[playerKey(entry.address)] ?? "0")));
        }
        r.audit ??= [];
        r.audit.push(
          structuredClone({
            round: room.engine!.round,
            state: room.engine,
            actions,
            resolve: shared,
            feesWei: r.feesWei,
          }),
        );
        // Serialize private round snapshots with result persistence. A final
        // atomic result also contains the entire log if an earlier write failed.
        void this.locked(r.code, () => this.save(r)).catch(this.report);
      },
      beforeFinish: () => this.locked(r.code, () => this.persistResult(r, runner)),
      onError: (error) => {
        this.report(error);
        for (const seat of runner.humans)
          this.send(seat.id, "room:error", {
            message: "Konfirmasi chain/penyimpanan tertunda. Periksa status room; dana tetap mengikuti escrow.",
          });
      },
    });
    this.rooms.set(r.code, runner);
  }

  private async start(r: MatchRecord, room: RoomRunner) {
    if (r.status !== "waiting") throw new Error("Match cannot start");
    const chainRoom = await this.chain.room(r.roomId);
    const seats = room.humans;
    if (
      chainRoom.status !== 1 ||
      seats.length < 2 ||
      chainRoom.players.length !== seats.length ||
      !seats.every((s) => s.ready && s.connected) ||
      !chainRoom.players.every((p) => seats.some((s) => s.id === playerKey(p)))
    )
      throw new Error("Ready roster differs from confirmed escrow roster");
    r.roster = await Promise.all(
      chainRoom.players.map(async (address) => ({
        address,
        num: seats.find((s) => s.id === playerKey(address))!.num,
        budgetWei: (await this.chain.entry(r.roomId, address)).skillBudgetWei.toString(),
      })),
    );
    const hash = nativeRosterHash(r.roster.map((p) => p.address));
    r.status = "starting";
    await this.save(r);
    try {
      await this.chain.write(`start:${r.matchId}`, "startRoom", [r.roomId, hash]);
      const active = await this.chain.room(r.roomId);
      if (active.status !== 2 || active.rosterHash !== hash) throw new Error("Started escrow roster mismatch");
      // A wallet can leave/rejoin with a different budget before start without
      // changing the address-only roster hash. Verify reserves after freezing.
      for (const entry of r.roster) {
        const frozen = await this.chain.entry(r.roomId, entry.address);
        if (!frozen.joined || frozen.skillBudgetWei !== BigInt(entry.budgetWei))
          throw new Error("Skill reserve changed while escrow was starting; recover by timeout refund");
      }
      r.status = "active";
      await this.save(r);
    } catch (error) {
      r.status = "recovery";
      await this.save(r);
      throw error;
    }
  }

  private price(r: MatchRecord, skill: Skill) {
    return nativeSkillPrice(BigInt(r.bidWei), skill === "goldHelm" ? "helmet" : skill);
  }
  private validateAction(r: MatchRecord, room: RoomRunner, id: string, action: RoundSubmit) {
    const seat = room.seatOf(id);
    const player = room.engine?.players.find((p) => p.num === seat?.num);
    const entry = r.roster.find((p) => playerKey(p.address) === id);
    if (r.status !== "active" || !player || !entry || !room.engine) return "Match tidak aktif.";
    if (
      (action.moveTo && !isSolid(action.moveTo, room.engine.n, room.engine.sunkRings)) ||
      (action.mineAt && !isSolid(action.mineAt, room.engine.n, room.engine.sunkRings))
    )
      return "Petak tidak valid.";
    if (action.skill) {
      if (!canUseSkill(player, action.skill)) return "Skill masih cooldown atau tidak tersedia.";
      if (BigInt(r.feesWei[id] ?? "0") + this.price(r, action.skill) > BigInt(entry.budgetWei))
        return "Budget skill terkunci tidak cukup.";
    }
    return null;
  }

  private async persistResult(r: MatchRecord, room: RoomRunner) {
    if (r.result) return;
    const end = room.engine?.end;
    if (!end || end.winners.length === 0 || new Set(end.winners).size !== end.winners.length)
      throw new Error("Invalid authoritative game result");
    const recipients = end.winners.map((num) => {
      const seat = r.roster.find((p) => p.num === num);
      if (!seat) throw new Error("Winner missing from frozen roster");
      return seat.address;
    });
    const payout = nativePayout(BigInt(r.bidWei), r.roster.length, recipients.length);
    const skillFeesWei = r.roster.map((p) => {
      const fee = BigInt(r.feesWei[playerKey(p.address)] ?? "0");
      if (fee > BigInt(p.budgetWei)) throw new Error("Skill fees exceed reserve");
      return fee.toString();
    });
    const data = {
      chainId: this.chain.config.chainId,
      vault: this.chain.config.vault,
      matchId: r.matchId,
      roomId: r.roomId,
      recipients,
      amountsWei: recipients.map(() => payout.payoutEachWei.toString()),
      skillFeesWei,
      rosterHash: nativeRosterHash(r.roster.map((p) => p.address)),
      potWei: payout.potWei.toString(),
      dustWei: payout.dustWei.toString(),
      reason: end.reason,
      round: room.engine!.round,
      kills: end.kills,
    };
    const result = { ...data, resultHash: keccak256(toHex(JSON.stringify(data))) };
    // Result + pending job status share one atomic journal record.
    const saved: MatchRecord = { ...r, result, status: "result" };
    await this.save(saved);
    Object.assign(r, saved);
    end.payoutEach = Number(formatEther(payout.payoutEachWei));
    end.skillFees = Object.fromEntries(r.roster.map((p, i) => [p.num, Number(formatEther(BigInt(skillFeesWei[i])))]));
    void this.settle(r.code).catch(this.report);
  }

  async result(code: string, address: Address) {
    const r = this.record(code);
    if (!r.roster.some((p) => playerKey(p.address) === playerKey(address)))
      throw new Error("Only frozen roster participants can read results");
    return {
      roomId: code,
      status: r.status,
      result: r.result ?? null,
      txHash: r.settlementTx ?? null,
      recoveryTxHash: r.recoveryTx ?? null,
    };
  }
  async claim(code: string, address: Address) {
    await this.result(code, address);
    await this.settle(code);
    return this.result(code, address);
  }

  private async settle(code: string) {
    return this.locked(code, async () => {
      const r = this.record(code);
      if (!r.result || r.status === "cancelled") return;
      const room = await this.chain.room(r.roomId);
      if (room.status === 3) {
        if (room.resultHash !== r.result.resultHash)
          throw new Error("Persisted result does not match settled resultHash");
        r.status = "settled";
        r.settlementTx ??= (await this.store.get<{ hash: Hex }>(`tx:settle:${r.matchId}`))?.hash;
        await this.save(r);
      } else if (room.status === 4) {
        r.status = "cancelled";
        await this.save(r);
      } else if (room.status === 2) {
        if ((await this.chain.timestamp()) >= room.settlementDeadline) {
          r.recoveryTx = await this.chain.write(`refund:${r.matchId}`, "refundExpiredRoom", [r.roomId]);
          r.status = "cancelled";
          await this.save(r);
        } else {
          const result = r.result;
          r.settlementTx = await this.chain.write(`settle:${r.matchId}`, "settleRoom", [
            r.roomId,
            result.recipients,
            result.amountsWei.map(BigInt),
            result.skillFeesWei.map(BigInt),
            result.rosterHash,
            result.resultHash,
          ]);
          const confirmed = await this.chain.room(r.roomId);
          if (confirmed.status !== 3 || confirmed.resultHash !== result.resultHash)
            throw new Error("Settlement confirmation mismatch");
          r.status = "settled";
          await this.save(r);
        }
      } else throw new Error("Escrow is not active or terminal");
      this.notify(
        r.roster.map((p) => p.address),
        { roomId: code, status: r.status, txHash: r.settlementTx ?? r.recoveryTx },
      );
    });
  }

  async work() {
    if (this.busyWorker || this.stopped) return;
    this.busyWorker = true;
    try {
      for (const r of this.records.values()) {
        if (this.stopped) break;
        try {
          if (r.result && !["settled", "cancelled"].includes(r.status)) await this.settle(r.code);
          else if (
            r.status === "recovery" ||
            (r.status === "waiting" && (await this.chain.timestamp()) >= BigInt(r.joinDeadline)) ||
            (r.status === "active" &&
              (await this.chain.timestamp()) >= (await this.chain.room(r.roomId)).settlementDeadline)
          ) {
            await this.locked(r.code, async () => {
              if (this.rooms.get(r.code)?.startPending) return;
              const room = await this.chain.room(r.roomId);
              if (room.status === 1)
                r.recoveryTx = await this.chain.write(`cancel:${r.matchId}`, "cancelWaitingRoom", [r.roomId]);
              else if (room.status === 2) {
                if ((await this.chain.timestamp()) < room.settlementDeadline) return;
                r.recoveryTx = await this.chain.write(`refund:${r.matchId}`, "refundExpiredRoom", [r.roomId]);
              } else if (room.status === 3)
                throw new Error("Settled room has no local result; operator review required");
              r.status = "cancelled";
              await this.save(r);
              this.rooms.get(r.code)?.dispose();
            });
          }
        } catch (error) {
          this.report(error);
        }
      }
    } finally {
      this.busyWorker = false;
    }
  }

  async close() {
    this.stopped = true;
    for (const room of this.rooms.values()) room.dispose();
    while (this.busyWorker) await new Promise((resolve) => setTimeout(resolve, 25));
    await Promise.allSettled([...this.locks.values()]);
  }
}
