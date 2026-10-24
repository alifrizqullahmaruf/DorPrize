import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import cors from "cors";
import express from "express";
import { Server, type Socket } from "socket.io";
import { LOGIN_HEADER, type ClientEvents, type ServerEvents } from "@dorprize/game-core";
import { verifyLogin, type ChainService } from "./chain";
import type { ServerConfig } from "./config";
import { RoomRegistry } from "./registry";
import { parseCreateRoom, parseJoin, parseName, parsePlayerId, parseSubmit } from "./validate";

type SocketData = { playerId: string; name: string; roomId?: string };
// protocol.ts describes payloads; Socket.io wants handler signatures.
// Client payloads stay `unknown` here: they are validated before use.
type ClientHandlers = { [K in keyof ClientEvents]: (payload: unknown) => void };
type ServerHandlers = { [K in keyof ServerEvents]: (payload: ServerEvents[K]) => void };
type IO = Server<ClientHandlers, ServerHandlers, Record<string, never>, SocketData>;
type GameSocket = Socket<ClientHandlers, ServerHandlers, Record<string, never>, SocketData>;

/** Socket.io room that holds every connection (tab) of one player. */
const playerChannel = (playerId: string) => `player:${playerId}`;

export type GameServer = {
  httpServer: HttpServer;
  io: IO;
  registry: RoomRegistry;
  /** Resolves with the bound port (pass 0 for a random free port). */
  listen: (port?: number) => Promise<number>;
  close: () => Promise<void>;
};

/** WalletLogin from the `x-dorprize-login` header (base64 JSON). */
function loginFromHeader(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * @param chain On-chain bids (RoomManager). Without it, players use guest ids and
 *              bids are not locked.
 */
export function createGameServer(config: ServerConfig, chain?: ChainService): GameServer {
  const app = express();
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "16kb" }));

  const httpServer = createServer(app);
  const io: IO = new Server(httpServer, {
    cors: { origin: config.corsOrigins, credentials: true },
    maxHttpBufferSize: 16_000,
  });

  const registry = new RoomRegistry(
    config,
    (playerId, event, payload) => {
      // Each player only receives what is addressed to them (their own secrets).
      io.to(playerChannel(playerId)).emit(event, ...([payload] as Parameters<ServerHandlers[typeof event]>));
    },
    Date.now,
    chain,
  );

  // ---------------------------------------------------------------- REST

  app.get("/health", (_req, res) => {
    res.json({ ok: true, rooms: registry.size, players: io.engine.clientsCount });
  });

  app.get("/rooms", (_req, res) => {
    res.json(registry.listOpen());
  });

  app.post("/rooms", (req, res) => {
    const input = parseCreateRoom(req.body);
    if (typeof input === "string") {
      res.status(400).json({ error: input });
      return;
    }
    res.status(201).json({ roomId: registry.create(input).roomId });
  });

  // Signed JoinTicket for RoomManager.joinRoom, only for a player seated in the lobby.
  app.post("/rooms/:id/ticket", async (req, res) => {
    if (!chain) return void res.status(404).json({ error: "On-chain bids are off." });
    const player = await verifyLogin(loginFromHeader(req.get(LOGIN_HEADER)));
    if (!player) return void res.status(401).json({ error: "Login wallet dulu." });
    const room = registry.get(String(req.params.id).toUpperCase());
    if (!room) return void res.status(404).json({ error: "Room tidak ditemukan." });
    if (!room.seatOf(player)) return void res.status(403).json({ error: "Masuk ke room dulu." });
    if (room.status !== "LOBBY") return void res.status(409).json({ error: "Game di room ini sudah dimulai." });
    try {
      res.json(await chain.ticket(room.roomId, player, room.bid, room.maxPlayers));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Gagal membuat tiket." });
    }
  });

  // Status of the automatic on-chain payout for a finished room.
  app.get("/rooms/:id/settlement", (req, res) => {
    const status = chain?.settlementOf(String(req.params.id).toUpperCase());
    res.json(status ?? { status: "none" });
  });

  // ---------------------------------------------------------------- Socket.io

  // Identify the player before anything else: a signed wallet login (required with
  // on-chain bids, the address is the player id) or a guest id.
  io.use(async (socket, next) => {
    const auth = socket.handshake.auth as Record<string, unknown>;
    const wallet = auth?.login ? await verifyLogin(auth.login) : null;
    if (chain && !wallet) return next(new Error("wallet login required"));
    const playerId = wallet ?? parsePlayerId(auth?.playerId);
    if (!playerId) return next(new Error("invalid playerId"));
    socket.data.playerId = playerId;
    socket.data.name = parseName(auth?.name);
    next();
  });

  io.on("connection", (socket: GameSocket) => {
    const { playerId } = socket.data;
    socket.join(playerChannel(playerId));
    const currentRoom = () => (socket.data.roomId ? registry.get(socket.data.roomId) : undefined);
    const fail = (message: string) => socket.emit("room:error", { message });

    socket.on("room:join", (payload: unknown) => {
      const join = parseJoin(payload);
      if (!join) return fail("Data join tidak valid.");
      const room = registry.get(join.roomId);
      if (!room) return fail("Room tidak ditemukan.");
      // Only leave the current room once the new one will accept us.
      const blocked = room.canJoin(playerId);
      if (blocked) return fail(blocked);
      const previous = currentRoom();
      if (previous && previous !== room) previous.leave(playerId);
      const result = room.join(playerId, join.name, join.skin);
      if (!result.ok) return fail(result.error);
      socket.data.roomId = room.roomId;
    });

    socket.on("room:skin", (payload: unknown) => {
      const skin = (payload as { skin?: unknown })?.skin;
      if (typeof skin === "string") currentRoom()?.setSkin(playerId, skin);
    });

    socket.on("room:ready", async (payload: unknown) => {
      const room = currentRoom();
      const ready = (payload as { ready?: unknown })?.ready === true;
      if (!room) return;
      // On-chain bids: ready only once the bid is actually locked in RoomManager.
      if (chain && ready && !(await lockedOnChain(room.roomId))) {
        return fail("Bid belum terkunci on-chain. Coba SIAP lagi.");
      }
      room.setReady(playerId, ready);
    });

    /** The joinRoom tx was just mined; give the RPC a moment to catch up. */
    async function lockedOnChain(roomId: string) {
      for (let i = 0; i < 4; i++) {
        try {
          if (await chain!.isInRoom(roomId, playerId)) return true;
        } catch {
          // RPC hiccup: retry
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      return false;
    }

    socket.on("room:leave", () => {
      currentRoom()?.leave(playerId);
      socket.data.roomId = undefined;
    });

    socket.on("round:submit", (payload: unknown) => {
      const action = parseSubmit(payload);
      if (action) currentRoom()?.submit(playerId, action);
    });

    socket.on("disconnect", () => {
      const room = currentRoom();
      if (!room) return;
      // Another tab of the same player may still be in this room.
      const tabs = io.sockets.adapter.rooms.get(playerChannel(playerId)) ?? new Set<string>();
      const stillHere = [...tabs].some((id) => io.sockets.sockets.get(id)?.data.roomId === room.roomId);
      if (!stillHere) room.disconnect(playerId);
    });
  });

  const sweeper = setInterval(() => registry.sweep(), config.sweepIntervalMs);
  sweeper.unref();

  return {
    httpServer,
    io,
    registry,
    listen: (port = config.port) =>
      new Promise((resolve) => {
        httpServer.listen(port, () => resolve((httpServer.address() as AddressInfo).port));
      }),
    close: async () => {
      clearInterval(sweeper);
      registry.dispose();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
