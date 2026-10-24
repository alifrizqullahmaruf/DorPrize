import type { ClientEvents, CreateRoomInput, RoomSummary, ServerEvents } from "@dorprize/game-core";
import { backendFetch, backendPost } from "@/shared/backend/api";

export type Unsubscribe = () => void;

export interface GameTransport {
  connect(): Promise<void>;
  on<E extends keyof ServerEvents>(event: E, cb: (payload: ServerEvents[E]) => void): Unsubscribe;
  emit<E extends keyof ClientEvents>(event: E, payload: ClientEvents[E]): void;
  listRooms(): Promise<RoomSummary[]>;
  createRoom(input: CreateRoomInput): Promise<{ roomId: string }>;
  /** Re-send the handshake (new wallet login). */
  reauth?(): void;
}

type RoomsApi = Pick<GameTransport, "listRooms" | "createRoom">;

/**
 * Listing and creating rooms. With the real server these are plain REST calls,
 * so browsing rooms does not need a (wallet-authenticated) socket yet.
 */
export async function getRoomsApi(): Promise<RoomsApi> {
  if (TRANSPORT_KIND !== "socket") return getTransport();
  return {
    listRooms: () => backendFetch<RoomSummary[]>("/rooms"),
    createRoom: (input) => backendPost<{ roomId: string }>("/rooms", input),
  };
}

export const TRANSPORT_KIND: "mock" | "socket" =
  process.env.NEXT_PUBLIC_GAME_TRANSPORT === "socket" ? "socket" : "mock";

let pending: Promise<GameTransport> | null = null;

/** One shared, connected transport. Concurrent callers share the same attempt. */
export function getTransport(): Promise<GameTransport> {
  pending ??= (async () => {
    const t: GameTransport =
      TRANSPORT_KIND === "socket"
        ? new (await import("@/features/game/net/socketTransport")).SocketTransport()
        : new (await import("@/features/game/net/mockTransport")).MockTransport();
    await t.connect();
    return t;
  })().catch((e) => {
    // Forget a failed attempt so a later call can retry.
    pending = null;
    throw e;
  });
  return pending;
}
