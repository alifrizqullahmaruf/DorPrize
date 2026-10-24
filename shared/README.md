# @dorprize/game-core (shared)

Game logic shared by the frontend and the backend, so the in-browser mock and the real server always follow the same rules.

| File          | Contents                                                                  |
| ------------- | ------------------------------------------------------------------------- |
| `protocol.ts` | Socket.io event payloads (client ↔ server)                                |
| `rules.ts`    | Constants: timings, skill costs and cooldowns, board sizes                |
| `geometry.ts` | Grid helpers: directions, rings, shrinking arena, shot paths              |
| `engine.ts`   | Pure round resolver: moves, mines, shots, shields, helmets, win check     |
| `room.ts`     | `RoomRunner`: lobby, countdown, rounds, reconnects and per-player secrets |
| `bots.ts`     | Simple bot decisions                                                      |
| `skins.ts`    | Character skin palette                                                    |

`RoomRunner` never touches the network: every message goes through the `send` callback, which lets the same class run in the browser and on the server.

```bash
npm test            # vitest (engine + room lifecycle)
npm run typecheck
```
