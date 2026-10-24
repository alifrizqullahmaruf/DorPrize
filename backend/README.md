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

- **Identity:** the client sends `auth: { playerId, name }` in the handshake. `playerId` is a guest id from browser `localStorage`, to be replaced by the wallet address once SIWE is added.
- **Reconnect:** seats belong to `playerId`, not to a socket. A reconnecting client re-sends `room:join` and gets the current `room:state` and phase again. While disconnected the player stays alive and the game keeps running; a game with nobody connected is dropped after `IDLE_GAME_TTL_MS`.
- **Leaving:** `room:leave` frees the seat in the lobby; mid-game the player forfeits and their bid stays in the pot.
- **Timing:** `round:submit` is accepted up to 1 s after the `deadline`, and `serverNow` lets clients correct clock skew.
- **Hidden positions:** every event goes to the receiver's own `player:<id>` channel. `room:state` has no coordinates; opponents are only revealed in `round:resolve.revealed`.
- **Untrusted input:** payloads are shape-checked in [src/validate.ts](src/validate.ts) before reaching the engine, which re-checks the game rules.
- **Storage:** in memory. Empty lobbies are dropped after 10 minutes; a game every player walked out of is dropped right away.

Not built yet: SIWE, `joinRoom` tickets, the `startRoom` / `settleRoom` relayer and persistent storage.
