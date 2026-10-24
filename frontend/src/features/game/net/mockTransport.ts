/**
 * In-browser stand-in for the DOR PRIZE server: the very same RoomRunner the
 * backend uses, with bots filling the rooms. Lets the frontend be played and
 * demoed without the Socket.io server.
 *
 * URL flags: ?fast=1 / ?slow=1 (phase speed), ?bots=N (bots per room).
 */
import { RoomRunner, makeRoomId } from "@dorprize/game-core";
import type { ClientEvents, CreateRoomInput, RoomSummary, RoundSubmit, ServerEvents } from "@dorprize/game-core";
import { timeScale } from "@/features/game/state/timeline";
import type { GameTransport, Unsubscribe } from "@/features/game/net/transport";

type Listener = (payload: unknown) => void;

/** The only human in the mock. */
const ME = "me";

function readFlag(name: string) {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export class MockTransport implements GameTransport {
  private listeners = new Map<string, Set<Listener>>();
  private rooms = new Map<string, RoomRunner>();
  private current: RoomRunner | null = null;
  private seeded = false;

  async connect() {}

  on<E extends keyof ServerEvents>(event: E, cb: (payload: ServerEvents[E]) => void): Unsubscribe {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb as Listener);
    this.listeners.set(event, set);
    return () => set.delete(cb as Listener);
  }

  emit<E extends keyof ClientEvents>(event: E, payload: ClientEvents[E]) {
    const room = this.current;
    switch (event) {
      case "room:join":
        this.join(payload as ClientEvents["room:join"]);
        break;
      case "room:skin":
        room?.setSkin(ME, (payload as ClientEvents["room:skin"]).skin);
        break;
      case "room:ready":
        room?.setReady(ME, (payload as ClientEvents["room:ready"]).ready);
        break;
      case "room:leave":
        room?.leave(ME);
        this.current = null;
        break;
      case "round:submit":
        room?.submit(ME, payload as RoundSubmit);
        break;
    }
  }

  async listRooms(): Promise<RoomSummary[]> {
    this.seed();
    return [...this.rooms.values()].filter((r) => r.isOpen).map((r) => r.summary());
  }

  async createRoom(input: CreateRoomInput) {
    this.seed();
    return { roomId: this.makeRoom(makeRoomId(), input).roomId };
  }

  // ------------------------------------------------------------------ internals

  private deliver<E extends keyof ServerEvents>(playerId: string, event: E, payload: ServerEvents[E]) {
    if (playerId !== ME) return;
    // Async, like a real socket.
    setTimeout(() => this.listeners.get(event)?.forEach((cb) => cb(payload)), 0);
  }

  private makeRoom(roomId: string, input: CreateRoomInput) {
    const flagBots = Number(readFlag("bots"));
    const room = new RoomRunner({
      roomId,
      name: input.name,
      bid: input.bid,
      maxPlayers: input.maxPlayers,
      isPrivate: input.isPrivate,
      targetBots: Number.isFinite(flagBots) && flagBots > 0 ? flagBots : Math.min(input.maxPlayers - 1, 5),
      timeScale: timeScale(),
      send: (id, event, payload) => this.deliver(id, event, payload),
      onEmpty: (id) => {
        // A finished or abandoned game is gone; open lobbies stay listed.
        const r = this.rooms.get(id);
        if (r && r.status !== "LOBBY") {
          r.dispose();
          this.rooms.delete(id);
        }
      },
    });
    this.rooms.set(roomId, room);
    return room;
  }

  private seed() {
    if (this.seeded) return;
    this.seeded = true;
    const presets: CreateRoomInput[] = [
      { name: "Arena Pemula", bid: 1, maxPlayers: 6, isPrivate: false },
      { name: "Lava Panas", bid: 2, maxPlayers: 10, isPrivate: false },
      { name: "Duel Cepat", bid: 5, maxPlayers: 4, isPrivate: false },
    ];
    for (const p of presets) {
      this.makeRoom(makeRoomId(), p).addBots(1 + Math.floor(Math.random() * Math.min(3, p.maxPlayers - 1)));
    }
  }

  private join({ roomId, name, skin }: ClientEvents["room:join"]) {
    this.seed();
    const id = roomId.toUpperCase();
    // Unknown code (e.g. scanned from another device): create it on the fly.
    const room =
      this.rooms.get(id) ?? this.makeRoom(id, { name: `Room ${id}`, bid: 1, maxPlayers: 6, isPrivate: true });
    // Only leave the current room once the new one will accept us.
    const blocked = room.canJoin(ME);
    if (blocked) {
      this.deliver(ME, "room:error", { message: blocked });
      return;
    }
    if (this.current && this.current !== room) this.current.leave(ME);
    const result = room.join(ME, name, skin);
    if (!result.ok) {
      this.deliver(ME, "room:error", { message: result.error });
      return;
    }
    this.current = room;
  }
}
