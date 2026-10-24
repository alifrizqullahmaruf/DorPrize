import { io, type Socket } from "socket.io-client";
import type { ClientEvents, CreateRoomInput, RoomSummary, ServerEvents } from "@dorprize/game-core";
import { backendFetch, backendPost } from "@/shared/backend/api";
import { BACKEND_API_URL } from "@/shared/backend/config";
import { getPlayerId } from "@/shared/lib/playerId";
import { readLogin } from "@/shared/lib/walletLogin";
import { useProfile } from "@/features/wallet/profile";
import type { GameTransport, Unsubscribe } from "@/features/game/net/transport";

/**
 * Real game server (backend). The player is identified by a guest id in
 * the handshake; SIWE cookie auth comes with the on-chain phase.
 *
 * REST: GET /rooms -> RoomSummary[], POST /rooms -> { roomId }
 */
export class SocketTransport implements GameTransport {
  private socket: Socket | null = null;
  /** Last room joined: re-sent after a reconnect so the server resyncs us. */
  private lastJoin: ClientEvents["room:join"] | null = null;

  async connect() {
    if (this.socket?.connected) return;
    if (!BACKEND_API_URL) throw new Error("NEXT_PUBLIC_BACKEND_API_URL belum diisi.");
    const socket = io(BACKEND_API_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      // A signed wallet login (on-chain bids) wins over the guest id on the server.
      auth: (cb) => cb({ playerId: getPlayerId(), name: useProfile.getState().name, login: readLogin() }),
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error("Server game tidak merespons."));
      }, 8_000);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("connect_error", (err) => {
        clearTimeout(timer);
        socket.disconnect();
        reject(new Error(`Tidak bisa terhubung ke server game (${err.message}).`));
      });
    });
    // After the first successful connect, socket.io reconnects on its own.
    socket.io.on("reconnect", () => {
      if (this.lastJoin) socket.emit("room:join", this.lastJoin);
    });
    this.socket = socket;
  }

  /** Reconnect so the server sees a new handshake (e.g. after a wallet login). */
  reauth() {
    if (!this.socket) return;
    this.socket.disconnect();
    this.socket.connect();
  }

  on<E extends keyof ServerEvents>(event: E, cb: (payload: ServerEvents[E]) => void): Unsubscribe {
    const handler = cb as (...args: unknown[]) => void;
    this.socket?.on(event as string, handler);
    return () => {
      this.socket?.off(event as string, handler);
    };
  }

  emit<E extends keyof ClientEvents>(event: E, payload: ClientEvents[E]) {
    if (event === "room:join") this.lastJoin = payload as ClientEvents["room:join"];
    if (event === "room:leave") this.lastJoin = null;
    this.socket?.emit(event as string, payload);
  }

  listRooms() {
    return backendFetch<RoomSummary[]>("/rooms");
  }

  createRoom(input: CreateRoomInput) {
    return backendPost<{ roomId: string }>("/rooms", input);
  }
}
