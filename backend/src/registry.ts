import { RoomRunner, makeRoomId, type CreateRoomInput, type GameEnd, type SendFn } from "@dorprize/game-core";
import type { ChainService } from "./chain";
import type { ServerConfig } from "./config";

/** All live rooms on this server (in memory). */
export class RoomRegistry {
  private rooms = new Map<string, RoomRunner>();

  constructor(
    private config: ServerConfig,
    private send: SendFn,
    private now: () => number = Date.now,
    private chain?: ChainService,
  ) {}

  create(input: CreateRoomInput): RoomRunner {
    let roomId = makeRoomId();
    while (this.rooms.has(roomId)) roomId = makeRoomId();
    const room = new RoomRunner({
      roomId,
      name: input.name,
      bid: input.bid,
      maxPlayers: input.maxPlayers,
      isPrivate: input.isPrivate,
      targetBots: this.config.allowBots ? this.config.botsPerRoom : 0,
      timeScale: this.config.timeScale,
      send: this.send,
      now: this.now,
      // A game everyone walked out of (on purpose) is over; empty lobbies are
      // swept later (the creator may still be on their way in).
      onEmpty: (id) => {
        const r = this.rooms.get(id);
        if (r && r.status !== "LOBBY") this.remove(id);
      },
      // On-chain bids: close the room when the game starts, pay the pot when it ends.
      onStart: this.chain ? (room) => this.startOnChain(room) : undefined,
      onEnd: this.chain ? (room, end) => this.settleOnChain(room, end) : undefined,
    });
    this.rooms.set(roomId, room);
    return room;
  }

  private startOnChain(room: RoomRunner) {
    this.chain!.start(room.roomId).then(
      (hash) => console.log(`startRoom ${room.roomId}: ${hash}`),
      (e) => console.error(`startRoom ${room.roomId} failed:`, e),
    );
  }

  private settleOnChain(room: RoomRunner, end: GameEnd) {
    const addressOf = (num: number) => room.seats.find((s) => s.num === num && !s.isBot)?.id;
    this.chain!.settle(room.roomId, end, addressOf).then(
      () => console.log(`settleRoom ${room.roomId}: ${JSON.stringify(this.chain!.settlementOf(room.roomId))}`),
      (e) => console.error(`settleRoom ${room.roomId} failed:`, e),
    );
  }

  get(roomId: string) {
    return this.rooms.get(roomId);
  }

  /** Public rooms that can still be joined. */
  listOpen() {
    return [...this.rooms.values()].filter((r) => r.isOpen).map((r) => r.summary());
  }

  get size() {
    return this.rooms.size;
  }

  remove(roomId: string) {
    this.rooms.get(roomId)?.dispose();
    this.rooms.delete(roomId);
  }

  /**
   * Drop lobbies nobody joined for a while, finished games nobody watches and
   * running games whose players dropped and never came back.
   */
  sweep() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      const nobody = !room.humans.some((s) => s.connected);
      if (!nobody) continue;
      // A lobby counts as idle from when it last emptied (or was created, if nobody ever joined).
      const staleLobby =
        room.status === "LOBBY" && now - (room.emptySince ?? room.createdAt) > this.config.idleLobbyTtlMs;
      const abandoned = room.emptySince !== null && now - room.emptySince > this.config.idleGameTtlMs;
      if (staleLobby || room.status === "FINISHED" || (room.status !== "LOBBY" && abandoned)) this.remove(room.roomId);
    }
  }

  dispose() {
    for (const id of [...this.rooms.keys()]) this.remove(id);
  }
}
