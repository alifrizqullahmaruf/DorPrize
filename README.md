# DOR PRIZE

A blind-shot arena game for 2–10 players on a shrinking lava board, built for **Monad Blitz #2**. Players bet testnet USDC; the last one standing takes the pot. Product spec: [docs/PRD.md](docs/PRD.md).

## Live demo

- **Play:** _<Vercel URL>_
- **Network:** Monad testnet (chain id `10143`), explorer [testnet.monadexplorer.com](https://testnet.monadexplorer.com)

| Contract    | Proxy address                                                                                                                        | Implementation                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| GameUSDC    | [`0xf56D47AAA4b4a71417551d57529fdA362aC9E5CF`](https://testnet.monadexplorer.com/address/0xf56D47AAA4b4a71417551d57529fdA362aC9E5CF) | [`0x4a2c123fFb69A5007A01c27dF549B75AF2cDC0DE`](https://testnet.monadexplorer.com/address/0x4a2c123fFb69A5007A01c27dF549B75AF2cDC0DE) |
| USDCFaucet  | [`0x36029A04da559abE23429Fc2c4315b28b9a490D0`](https://testnet.monadexplorer.com/address/0x36029A04da559abE23429Fc2c4315b28b9a490D0) | [`0xC7eB43F8507645BF65919783815934dFdDeD8d84`](https://testnet.monadexplorer.com/address/0xC7eB43F8507645BF65919783815934dFdDeD8d84) |
| GameVault   | [`0xf1bBA0433e2e51571C9251F1d72E0a1B57d81716`](https://testnet.monadexplorer.com/address/0xf1bBA0433e2e51571C9251F1d72E0a1B57d81716) | [`0xa89f60Ef07C0F6d2523701db996837D2a29a8520`](https://testnet.monadexplorer.com/address/0xa89f60Ef07C0F6d2523701db996837D2a29a8520) |
| RoomManager | [`0x58f9666c7b3eD684Ee9fabB82DA8719408C16562`](https://testnet.monadexplorer.com/address/0x58f9666c7b3eD684Ee9fabB82DA8719408C16562) | [`0x2E3aA9052A3abccbB5423f6CbAaA032A79a99cFE`](https://testnet.monadexplorer.com/address/0x2E3aA9052A3abccbB5423f6CbAaA032A79a99cFE) |

All eight contracts are verified on MonadVision (Sourcify, exact match). Use the **proxy** addresses to interact.

**Try it with a friend:** open the live URL in two browsers, connect a wallet on Monad testnet, claim test USDC from the **Faucet** and **Deposit** it into the vault (both are on-chain transactions), then one player creates a room and the other joins with the room code. Both press **SIAP** and the shootout starts.

What runs on-chain today: faucet, vault deposit and withdraw. Locking bids in `RoomManager` and paying the pot on-chain need backend join tickets and a settlement relayer, which are next; until then the game itself is played through the game server.

## Repository layout

```
dorprize/
├─ frontend/   Next.js 16 + React 19 + React Three Fiber game, lobby and wallet UI
├─ backend/    Node + Express + Socket.io game server (rooms, rounds, hidden positions)
├─ sc/         Foundry smart contracts: GameUSDC, USDCFaucet, GameVault, RoomManager
├─ shared/     @dorprize/game-core: rules, round engine, RoomRunner, Socket.io protocol
└─ docs/       PRD and rulebook
```

| Folder                         | Package               | Details                                       |
| ------------------------------ | --------------------- | --------------------------------------------- |
| [frontend](frontend/README.md) | `@dorprize/frontend`  | Game client, wallet (Reown + wagmi), Vault UI |
| [backend](backend/README.md)   | `@dorprize/backend`   | Authoritative game server                     |
| [sc](sc/README.md)             | `@dorprize/contracts` | Contracts + generated ABIs for the frontend   |
| [shared](shared/README.md)     | `@dorprize/game-core` | Game logic used by both frontend and backend  |

The repo is an **npm workspaces** monorepo: one `npm install` at the root links every package. Game rules live only in `shared/` and are imported as `@dorprize/game-core`, so the browser mock and the real server always behave the same.

## Getting started

Requires Node.js 20.9+ and, for contracts, [Foundry](https://getfoundry.sh).

```bash
git clone --recurse-submodules <repo-url>
cd dorprize
npm install
cp frontend/.env.example frontend/.env.local   # demo mode by default
npm run dev                                    # http://localhost:3000
```

Already cloned without submodules? Run `git submodule update --init --recursive`.

| Command                           | What it does                                  |
| --------------------------------- | --------------------------------------------- |
| `npm run dev` / `build` / `start` | Run, build or serve the frontend              |
| `npm run dev:backend`             | Game server on http://localhost:3001          |
| `npm run dev:all`                 | Frontend + game server together               |
| `npm run lint`                    | ESLint (frontend)                             |
| `npm run typecheck`               | TypeScript in every workspace                 |
| `npm test`                        | Unit and integration tests (shared + backend) |
| `npm run format` / `format:check` | Prettier                                      |
| `npm run sc:test`                 | Contract tests (Foundry)                      |
| `npm run sc:abi`                  | Build contracts and export ABIs/addresses     |
| `npm run sc:deploy`               | Deploy contracts to Monad testnet             |

## Run modes

**Demo (default, no backend, no wallet).** `NEXT_PUBLIC_GAME_TRANSPORT=mock` runs the room server in the browser with bots, and `NEXT_PUBLIC_DEMO_OFFLINE=1` keeps a fake USDC balance in the browser. URL flags: `?fast=1`, `?slow=1`, `?bots=N` (e.g. `/room/TEST01?fast=1&bots=5`).

**Local multiplayer.** In `frontend/.env.local` set `NEXT_PUBLIC_GAME_TRANSPORT=socket` and `NEXT_PUBLIC_BACKEND_API_URL=http://localhost:3001`, then `npm run dev:all`. Open two different browsers (guest ids are per browser), join the same room code and press Ready in both. For solo testing start the backend with `ALLOW_BOTS=1`.

**On-chain (Monad testnet).** Deploy the contracts ([sc/README.md](sc/README.md)), run `npm run sc:abi`, set `NEXT_PUBLIC_DEMO_OFFLINE=0` and `NEXT_PUBLIC_REOWN_PROJECT_ID`. The wallet layer is adapted from [PassChick](https://github.com/wngstnr-code/pass-chick). `NEXT_PUBLIC_ONCHAIN_BIDS=1` additionally locks bids in `RoomManager`; it needs backend join tickets, which are not built yet, so keep it at `0`.

### Hosting the live demo (game server on a laptop)

The game server keeps open WebSocket connections, so it does not run on Vercel. For the demo it runs on a laptop behind a free Cloudflare tunnel ([install `cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)):

1. In `backend/.env` set `CORS_ORIGINS=http://localhost:3000,https://<your-app>.vercel.app`, then `npm run dev:backend`.
2. In a second terminal: `npm run tunnel` and copy the `https://….trycloudflare.com` URL it prints.
3. In Vercel → Settings → Environment Variables set `NEXT_PUBLIC_GAME_TRANSPORT=socket`, `NEXT_PUBLIC_BACKEND_API_URL=<tunnel URL>`, `NEXT_PUBLIC_DEMO_OFFLINE=0`, `NEXT_PUBLIC_REOWN_PROJECT_ID=<id>`, then **Redeploy**.
4. Keep both terminals running. A quick tunnel gets a new URL every time it restarts, which means repeating step 3.

## Deploying the frontend to Vercel

1. Import the repo and set **Root Directory = `frontend`**. Keep the default build settings and leave "Include files outside the Root Directory" on (the workspaces install from the repo root).
2. With no environment variables the game runs in demo mode.
3. `NEXT_PUBLIC_*` values are baked in at build time: redeploy after changing them. The game server must be hosted elsewhere (Railway, Render, Fly.io) with the Vercel domain in its `CORS_ORIGINS`.

## Controls

Over-the-shoulder camera while playing; isometric view in the lobby and when spectating.

- **Desktop:** click once to capture the mouse, then the mouse aims (snapped to 8 directions) and tilts the camera. **WASD / arrows** walk to any tile still standing. **F** holds fire, **1–4** buy skills, **Esc** releases the mouse, ⚙ sets sensitivity and sound. Moves lock automatically when the round timer ends.
- **Mobile:** left joystick to walk, drag to aim.

## Rules that differ from the original PRD

- Board size follows the player count: 2–3 → 8×8, 4–6 → 10×10, 7–10 → 12×12.
- From round 2 the outer ring sinks at the start of each round, down to 2×2. Lava does not kill: players on a sinking ring are pushed inwards and mines on it are destroyed.
- Everyone is revealed during the shootout and hidden again next round.

| Skill     | Cooldown | Rule                                                                      |
| --------- | -------- | ------------------------------------------------------------------------- |
| Mine      | 2        | Dropped on the tile you stand on when buying; explodes on an enemy there. |
| Shotgun   | 3        | Fires three ways: straight and ±45°.                                      |
| Shield    | 3        | No shooting this round; blocks shots from the direction you face.         |
| Gold helm | 4        | Single use: absorbs one hit, then falls off.                              |

## Assets

All voxel models and textures are drawn in code (no Minecraft assets) and sound effects are synthesized with Web Audio. Reference media in `docs/reference/` is kept locally and not committed.
