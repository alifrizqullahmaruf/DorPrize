import { io, type Socket } from "socket.io-client";
import type { ClientEvents, CreateRoomInput, RoomSummary, ServerEvents } from "@dorprize/game-core";
import { backendFetch, backendPost } from "@/shared/backend/api";
import { BACKEND_API_URL } from "@/shared/backend/config";
import { getPlayerId } from "@/shared/lib/playerId";
import { useProfile } from "@/features/wallet/profile";
import type { GameTransport, Unsubscribe } from "@/features/game/net/transport";
import { boardSizeFor } from "@dorprize/game-core";
import { formatEther, parseEther } from "viem";
import { getNativeSession, NATIVE_MODE } from "@/shared/backend/native";
import { nativePlayer, type NativeRoomInfo } from "@/features/wallet/native/transactions";

/**
 * Real game server (backend). The player is identified by a guest id in
 * the legacy handshake. Native mode uses a verified SIWE bearer session.
 *
 * REST: GET /rooms -> RoomSummary[], POST /rooms -> { roomId }
 */
export class SocketTransport implements GameTransport {
  private socket: Socket | null = null;
  /** Last room joined: re-sent after a reconnect so the server resyncs us. */
  private lastJoin: ClientEvents["room:join"] | null = null;
  private round = 0;
  private identity = "";
  private connecting: Promise<void> | null = null;
  private watchingSession = false;

  async connect(): Promise<void> {
    if (this.connecting) {
      await this.connecting;
      return this.connect();
    }
    const token = NATIVE_MODE ? getNativeSession()?.token || "" : "";
    if (this.socket?.connected && (!NATIVE_MODE || this.identity === token)) return;
    if (NATIVE_MODE && !token) {
      this.socket?.disconnect();
      this.lastJoin = null;
      return; // Public room listings do not require a socket session.
    }
    this.connecting = this.open(token).finally(() => {
      this.connecting = null;
    });
    await this.connecting;
  }

  private async open(token: string) {
    this.socket?.disconnect();
    if (!BACKEND_API_URL) throw new Error("NEXT_PUBLIC_BACKEND_API_URL belum diisi.");
    const socket = io(BACKEND_API_URL, {
      withCredentials: !NATIVE_MODE,
      transports: ["websocket", "polling"],
      auth: (cb) =>
        cb(
          NATIVE_MODE
            ? { token: getNativeSession()?.token, name: useProfile.getState().name }
            : { playerId: getPlayerId(), name: useProfile.getState().name },
        ),
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
    socket.on("round:start", (payload) => {
      this.round = payload.round;
    });
    if (NATIVE_MODE && !this.watchingSession) {
      this.watchingSession = true;
      window.addEventListener("dorprize:native-session", () => {
        if (getNativeSession()?.token !== this.identity) {
          this.socket?.disconnect();
          this.lastJoin = null;
        }
      });
    }
    this.identity = token;
    this.socket = socket;
  }

  on<E extends keyof ServerEvents>(event: E, cb: (payload: ServerEvents[E]) => void): Unsubscribe {
    const socket = this.socket;
    const handler = cb as (...args: unknown[]) => void;
    socket?.on(event as string, handler);
    return () => {
      socket?.off(event as string, handler);
    };
  }

  emit<E extends keyof ClientEvents>(event: E, payload: ClientEvents[E]) {
    if (event === "room:join") this.lastJoin = payload as ClientEvents["room:join"];
    if (event === "room:leave") this.lastJoin = null;
    if (NATIVE_MODE && event === "round:submit") {
      let seq = Date.now();
      try {
        seq = Math.max(seq, Number(sessionStorage.getItem("dorprize-native-seq") || 0) + 1);
        sessionStorage.setItem("dorprize-native-seq", String(seq));
      } catch {
        /* Millisecond sequence remains valid when storage is disabled. */
      }
      this.socket?.emit(event, { round: this.round, actionId: crypto.randomUUID(), seq, action: payload }, () => {});
    } else this.socket?.emit(event as string, payload);
  }

  async listRooms() {
    if (!NATIVE_MODE) return backendFetch<RoomSummary[]>("/rooms");
    const rooms = await backendFetch<NativeRoomInfo[]>("/rooms");
    return rooms.map((room): RoomSummary => ({
      ...room,
      bid: Number(formatEther(BigInt(room.bidWei))),
      boardSize: boardSizeFor(Math.max(2, room.players)),
      status: "LOBBY",
    }));
  }

  createRoom(input: CreateRoomInput & { bidWei?: string }) {
    if (NATIVE_MODE) {
      nativePlayer();
      return backendPost<{ roomId: string }>("/rooms", {
        name: input.name,
        bidWei: input.bidWei || parseEther(String(input.bid)).toString(),
        maxPlayers: input.maxPlayers,
        isPrivate: input.isPrivate,
      });
    }
    return backendPost<{ roomId: string }>("/rooms", input);
  }
}
