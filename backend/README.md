# @dorprize/backend

DOR PRIZE game server: Node + Express + Socket.io. All round rules run in `RoomRunner` from `@dorprize/game-core` ([shared](../shared)); this server only handles connections, input validation and the room registry.

```bash
cp .env.example .env   # optional
npm run dev            # from this folder, or `npm run dev:backend` from the root
npm test               # integration tests with real Socket.io clients
```

## Configuration

| Variable           | Default                 | Purpose                                            |
| ------------------ | ----------------------- | -------------------------------------------------- |
| `PORT`             | `3001`                  | HTTP + Socket.io port                              |
| `CORS_ORIGINS`     | `http://localhost:3000` | Allowed frontend origins, comma-separated          |
| `ALLOW_BOTS`       | `0`                     | `1` fills rooms with bots                          |
| `BOTS_PER_ROOM`    | `3`                     | Bots per room when enabled                         |
| `TIME_SCALE`       | `1`                     | Phase duration multiplier; `0.2` = 5× faster       |
| `IDLE_GAME_TTL_MS` | `120000`                | Running game with nobody connected is dropped then |

## API

REST: `GET /health`, `GET /rooms` (public rooms still in the lobby), `POST /rooms` (`{ name, bid, maxPlayers, isPrivate }` → `{ roomId }`).

Socket.io events are defined in [shared/src/protocol.ts](../shared/src/protocol.ts):

| Event                                                | Direction       | Notes                                                       |
| ---------------------------------------------------- | --------------- | ----------------------------------------------------------- |
| `room:join`, `room:skin`, `room:ready`, `room:leave` | client → server |                                                             |
| `round:submit`                                       | client → server | `{ moveTo, shootDir, skill, mineAt }`, sent when time is up |
| `room:state`                                         | server → client | No player positions                                         |
| `round:start`                                        | server → client | Only the receiver's own position, cooldowns and mines       |
| `round:resolve`                                      | server → client | `revealed[]` holds everyone's position during the shootout  |
| `game:end`                                           | server → client | Winners, payout, `skillFees`, `kills`                       |

## How it works

- **Identity:** with `ONCHAIN=1` the player id is the wallet address proven by a signed login message (see below). Without it, `playerId` is a guest id from browser `localStorage`.
- **Reconnect:** seats belong to `playerId`, not to a socket. A reconnecting client re-sends `room:join` and gets the current `room:state` and phase again. While disconnected the player stays alive and the game keeps running; a game with nobody connected is dropped after `IDLE_GAME_TTL_MS`.
- **Leaving:** `room:leave` frees the seat in the lobby; mid-game the player forfeits and their bid stays in the pot.
- **Timing:** `round:submit` is accepted up to 1 s after the `deadline`, and `serverNow` lets clients correct clock skew.
- **Hidden positions:** every event goes to the receiver's own `player:<id>` channel. `room:state` has no coordinates; opponents are only revealed in `round:resolve.revealed`.
- **Untrusted input:** payloads are shape-checked in [src/validate.ts](src/validate.ts) before reaching the engine, which re-checks the game rules.
- **Storage:** in memory. Empty lobbies are dropped after 10 minutes; a game every player walked out of is dropped right away.

## On-chain bids (`ONCHAIN=1`)

- **Wallet login:** the client signs a plain message (`loginMessage` in [shared/src/auth.ts](../shared/src/auth.ts)) and sends it in the handshake and the `x-dorprize-login` header. The verified address becomes the player id; guests are rejected. No cookies, so it works across domains.
- **`POST /rooms/:id/ticket`:** EIP-712 `JoinTicket` for a player seated in the lobby. `room:ready` is only accepted once `RoomManager.isInRoom` is true.
- **`startRoom` / `settleRoom`:** sent by the server when the countdown ends and when the game finishes ([src/chain.ts](src/chain.ts)). `GET /rooms/:id/settlement` reports the payout and its transaction hash.
- **Server key:** read from a Foundry keystore (`SIGNER_KEYSTORE`, default `~/.foundry/keystores/deployer`). The password is typed at start (`npm run start:backend`), never stored. The key must be RoomManager's `backendSigner` and `operator` and hold MON for gas.

Not built yet: persistent storage (rooms and pending payouts live in memory).
