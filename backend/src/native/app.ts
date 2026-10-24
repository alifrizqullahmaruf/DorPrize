import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Request, type RequestHandler } from "express";
import cors from "cors";
import { Server } from "socket.io";
import { getAddress, type Address } from "viem";
import { verifySiweMessage } from "viem/siwe";
import type { ServerConfig } from "../config";
import { parseJoin, parseName, parseRoomId, parseSubmit } from "../validate";
import type { NativeConfig } from "./config";
import { FileJournal, postgresJournal, type Journal } from "./store";
import { NativeChain } from "./chain";
import { WalletAuth } from "./auth";
import { NativeService } from "./service";

export async function createNativeServer(config: ServerConfig, native: NativeConfig, journal?: Journal) {
  const store =
    journal ??
    (native.databaseUrl ? await postgresJournal(native.databaseUrl) : await FileJournal.create(native.stateDirectory!));
  const chain = new NativeChain(native, store);
  const auth = new WalletAuth(native.authOrigin, native.chainId, (message, signature) =>
    verifySiweMessage(chain.client, {
      message,
      signature,
      domain: new URL(native.authOrigin).host,
      blockTag: "finalized",
    }),
  );
  const app = express();
  let closing = false;
  app.disable("x-powered-by");
  const origins = [...new Set([...config.corsOrigins, native.authOrigin])];
  app.use((req, res, next) => {
    if (closing) {
      res.status(503).json({ error: "Backend is shutting down" });
      return;
    }
    if (req.headers.origin && !origins.includes(req.headers.origin)) {
      res.status(403).json({ error: "Origin rejected" });
      return;
    }
    next();
  });
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: "16kb" }));
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const rates = new Map<string, { count: number; until: number }>();
  const consume = (key: string, limit: number) => {
    const now = Date.now();
    if (rates.size > 10_000) for (const [k, v] of rates) if (v.until <= now) rates.delete(k);
    const bucket = rates.get(key);
    if (bucket && bucket.until > now) return ++bucket.count <= limit;
    if (rates.size >= 20_000) return false;
    rates.set(key, { count: 1, until: now + 60_000 });
    return true;
  };
  const rateLimit: RequestHandler = (req, res, next) => {
    if (!consume(`http:${req.ip}`, 120)) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  };
  app.use(rateLimit);
  const bearer = (req: Request) => req.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  const wallet = (req: Request): Address => {
    const session = auth.session(bearer(req));
    if (!session) throw new Error("Wallet session required or expired");
    return session.address;
  };
  const code = (value: unknown) => {
    const parsed = parseRoomId(value);
    if (!parsed) throw new Error("Invalid room code");
    return parsed;
  };
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: origins },
    maxHttpBufferSize: 16_000,
    allowRequest: (req, done) => done(null, !req.headers.origin || origins.includes(req.headers.origin)),
  });
  const channel = (id: string) => `wallet:${id.toLowerCase()}`;
  const service = new NativeService(
    chain,
    store,
    config,
    (id, event, payload) => io.to(channel(id)).emit(event, payload),
    (players, payload) => {
      for (const player of players) io.to(channel(player)).emit("settlement:update", payload);
    },
  );
  try {
    await service.initialize();
  } catch (error) {
    await store.close();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    throw error;
  }

  app.get("/health", (_req, res) =>
    res.json({ ok: true, mode: "native", chainId: native.chainId, vault: native.vault }),
  );
  app.get("/ready", async (_req, res) => {
    try {
      await store.get("binding");
      if ((await chain.client.getChainId()) !== native.chainId) throw new Error("Chain mismatch");
      await chain.timestamp();
      res.json({ ok: true, mode: "native", chainId: native.chainId });
    } catch {
      res.status(503).json({ ok: false, error: "Native persistence or RPC unavailable" });
    }
  });
  app.get("/config", (_req, res) =>
    res.json({
      mode: "native",
      chainId: native.chainId,
      vault: native.vault,
      asset: "MON",
      decimals: 18,
      authOrigin: native.authOrigin,
    }),
  );
  app.post("/auth/challenge", (req, res) => res.json(auth.challenge(req.body?.address)));
  app.post("/auth/verify", async (req, res) => res.json(await auth.login(req.body?.challengeId, req.body?.signature)));
  app.post("/auth/logout", (req, res) => {
    const address = wallet(req);
    auth.logout(bearer(req)!);
    for (const socket of io.sockets.sockets.values()) if (socket.data.token === bearer(req)) socket.disconnect(true);
    res.json({ ok: true, address });
  });
  app.get("/auth/session", (req, res) => res.json({ address: wallet(req) }));
  app.get("/balance", async (req, res) => {
    const address = wallet(req);
    const [availableWei, bidLockedWei, skillReservedWei] = await Promise.all([
      chain.read<bigint>("availableBalanceOf", [address]),
      chain.read<bigint>("lockedBalanceOf", [address]),
      chain.read<bigint>("skillReservedOf", [address]),
    ]);
    res.json({
      address,
      availableWei: availableWei.toString(),
      bidLockedWei: bidLockedWei.toString(),
      skillReservedWei: skillReservedWei.toString(),
    });
  });
  app.get("/rooms", (_req, res) => res.json(service.list()));
  app.post("/rooms", async (req, res) => {
    const address = wallet(req);
    res.status(201).json(await service.create(address, req.body ?? {}));
  });
  app.get("/rooms/:id", (req, res) => {
    wallet(req);
    res.json(service.info(code(req.params.id)));
  });
  app.post("/rooms/:id/ticket", async (req, res) =>
    res.json(await service.ticket(code(req.params.id), wallet(req), req.body?.skillBudgetWei)),
  );
  app.get("/matches/:id/result", async (req, res) => res.json(await service.result(code(req.params.id), wallet(req))));
  app.post("/api/game/submit-settlement", async (req, res) => {
    if (Object.keys(req.body ?? {}).some((key) => key !== "roomId"))
      throw new Error("Only roomId is accepted; winners and amounts come from the server");
    res.json(await service.claim(code(req.body?.roomId), wallet(req)));
  });
  app.use(((error, _req, res, _next) => {
    // Never return raw provider errors: they can contain a credential-bearing RPC URL.
    const message =
      error instanceof Error && !("details" in error)
        ? error.message
        : "Chain operation unavailable; check room status and retry";
    res.status(message.includes("session") ? 401 : 400).json({ error: message });
  }) as express.ErrorRequestHandler);

  io.use((socket, next) => {
    if (closing) return next(new Error("Backend is shutting down"));
    const token = socket.handshake.auth?.token;
    const session = auth.session(token);
    if (!session) return next(new Error("Wallet session required"));
    socket.data.address = session.address;
    socket.data.token = token;
    next();
  });
  const actions = new Map<string, { round: number; seq: number; actionId: string; body: string }>();
  io.on("connection", (socket) => {
    const address = getAddress(socket.data.address);
    const id = address.toLowerCase();
    socket.join(channel(id));
    const expiry = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, auth.session(socket.data.token)!.expires - Date.now()),
    );
    expiry.unref();
    socket.use((_packet, next) => {
      if (!auth.session(socket.data.token)) {
        socket.disconnect(true);
        return;
      }
      if (!consume(`socket:${id}`, 300)) {
        socket.emit("room:error", { message: "Terlalu banyak aksi." });
        return;
      }
      next();
    });
    const room = () => service.rooms.get(socket.data.roomId);
    // Socket handlers are serialized per connection; service locks serialize tabs and chain transitions.
    let queue = Promise.resolve();
    const handle = (event: string, fn: (payload: unknown) => Promise<unknown> | unknown) =>
      socket.on(event, (payload, ack) => {
        queue = queue
          .then(async () => {
            if (!auth.session(socket.data.token)) throw new Error("Wallet session expired");
            const result = await fn(payload);
            if (typeof ack === "function") ack({ ok: true, result });
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error && !("details" in error)
                ? error.message
                : "Konfirmasi chain tertunda; periksa status room.";
            socket.emit("room:error", { message });
            if (typeof ack === "function") ack({ ok: false, error: message });
          });
      });
    handle("room:join", async (payload) => {
      const input = parseJoin(payload);
      if (!input) throw new Error("Invalid room join");
      if (socket.data.roomId && socket.data.roomId !== input.roomId)
        throw new Error("Leave current room before switching");
      await service.join(input.roomId, address, input.name || parseName(socket.handshake.auth?.name), input.skin);
      socket.data.roomId = input.roomId;
    });
    handle("room:ready", async (payload) => {
      if (typeof (payload as { ready?: unknown })?.ready !== "boolean") throw new Error("ready must be boolean");
      await service.ready(code(socket.data.roomId), address, (payload as { ready: boolean }).ready);
    });
    handle("room:skin", (payload) => {
      const skin = (payload as { skin?: unknown })?.skin;
      if (typeof skin === "string") room()?.setSkin(id, skin);
    });
    handle("room:leave", async () => {
      await service.leave(code(socket.data.roomId), address);
      socket.data.roomId = undefined;
    });
    handle("round:submit", (payload) => {
      const input = payload as { round?: unknown; actionId?: unknown; seq?: unknown; action?: unknown } | null;
      const current = room();
      const action = parseSubmit(input?.action);
      if (
        !current ||
        !input ||
        !action ||
        input.round !== current.engine?.round ||
        typeof input.actionId !== "string" ||
        !/^[A-Za-z0-9_-]{8,80}$/.test(input.actionId) ||
        !Number.isSafeInteger(input.seq) ||
        (input.seq as number) < 0
      )
        throw new Error("Invalid round, sequence or action envelope");
      const key = `${current.roomId}:${id}`;
      const previous = actions.get(key);
      const body = JSON.stringify(action);
      if (previous && previous.round === input.round) {
        if (previous.actionId === input.actionId && previous.seq === input.seq && previous.body === body)
          return { accepted: true, actionId: input.actionId };
        throw new Error("Action already locked for this round");
      }
      if (previous && (input.seq as number) <= previous.seq) throw new Error("Stale action sequence");
      if (!current.submit(id, action)) throw new Error("Action rejected or deadline passed");
      actions.set(key, { round: input.round as number, seq: input.seq as number, actionId: input.actionId, body });
      return { accepted: true, actionId: input.actionId };
    });
    socket.on("disconnect", () => {
      clearTimeout(expiry);
      const current = room();
      if (!current) return;
      const another = [...io.sockets.sockets.values()].some(
        (s) => s.id !== socket.id && s.data.address === address && s.data.roomId === current.roomId,
      );
      if (!another) current.disconnect(id);
    });
  });
  const worker = setInterval(() => {
    void service.work();
  }, native.workerIntervalMs);
  worker.unref();
  return {
    httpServer,
    io,
    service,
    chain,
    auth,
    listen: (port = config.port) =>
      new Promise<number>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, () => {
          httpServer.off("error", reject);
          resolve((httpServer.address() as AddressInfo).port);
        });
      }),
    close: async () => {
      closing = true;
      clearInterval(worker);
      await service.close();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await store.close();
    },
  };
}
