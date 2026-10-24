# DOR PRIZE

**Blind-shot battle royale on Monad.** 2–10 players stand on a shrinking lava board without seeing each other, pick a tile and a direction, and fire at the same time. The last one standing takes the USDC pot. Bids, the pot payout and skill fees settle on Monad testnet; positions stay hidden on the game server so nobody can read them from the chain.

Built at **Monad Blitz Jogja** (October 24, 2026). Product spec: [docs/PRD.md](docs/PRD.md).

## Live demo

|              |                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Play**     | **https://www.dorprize.xyz**                                                                                       |
| **Network**  | Monad testnet, chain id `10143`                                                                                    |
| **Explorer** | [testnet.monadexplorer.com](https://testnet.monadexplorer.com)                                                     |
| **Wallet**   | Any EVM wallet (MetaMask, Rabby, WalletConnect) with testnet MON from [faucet.monad.xyz](https://faucet.monad.xyz) |

### Contracts (Monad testnet)

Deployed during the Blitz on October 24, 2026 (first tx in block [73743747](https://testnet.monadexplorer.com/tx/0x2069b17d903221d27e738ece6c36a8df810c29a2afd4731b1d98efc23e9221db)). All eight contracts are **verified** on MonadVision (Sourcify, exact match). Interact with the **proxy** addresses.

| Contract    | Proxy address                                                                                                                        | Implementation                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| GameUSDC    | [`0xf56D47AAA4b4a71417551d57529fdA362aC9E5CF`](https://testnet.monadexplorer.com/address/0xf56D47AAA4b4a71417551d57529fdA362aC9E5CF) | [`0x4a2c123fFb69A5007A01c27dF549B75AF2cDC0DE`](https://testnet.monadexplorer.com/address/0x4a2c123fFb69A5007A01c27dF549B75AF2cDC0DE) |
| USDCFaucet  | [`0x36029A04da559abE23429Fc2c4315b28b9a490D0`](https://testnet.monadexplorer.com/address/0x36029A04da559abE23429Fc2c4315b28b9a490D0) | [`0xC7eB43F8507645BF65919783815934dFdDeD8d84`](https://testnet.monadexplorer.com/address/0xC7eB43F8507645BF65919783815934dFdDeD8d84) |
| GameVault   | [`0xf1bBA0433e2e51571C9251F1d72E0a1B57d81716`](https://testnet.monadexplorer.com/address/0xf1bBA0433e2e51571C9251F1d72E0a1B57d81716) | [`0xa89f60Ef07C0F6d2523701db996837D2a29a8520`](https://testnet.monadexplorer.com/address/0xa89f60Ef07C0F6d2523701db996837D2a29a8520) |
| RoomManager | [`0x58f9666c7b3eD684Ee9fabB82DA8719408C16562`](https://testnet.monadexplorer.com/address/0x58f9666c7b3eD684Ee9fabB82DA8719408C16562) | [`0x2E3aA9052A3abccbB5423f6CbAaA032A79a99cFE`](https://testnet.monadexplorer.com/address/0x2E3aA9052A3abccbB5423f6CbAaA032A79a99cFE) |

Example live transaction from the web app: [vault deposit of 50 USDC](https://testnet.monadexplorer.com/tx/0x42b27e68cf4cfcad982fe5ee730dce71fb51bc7653e46ed12ac8bbffe2b57839).

### Play with a friend

1. Open **https://www.dorprize.xyz** in two browsers (or a laptop and a phone) and connect a wallet on Monad testnet.
2. Press **FAUCET** for 100 test USDC, then **DEPOSIT** it into the vault (two on-chain transactions: approve and deposit).
3. **MAINKAN → BUAT ROOM** in one browser; join with the room code or QR in the other. Each player signs a free login message.
4. **SIAP** locks the bid in `RoomManager` (`joinRoom` with a backend-signed EIP-712 ticket).
5. The server calls `startRoom` when the countdown ends and `settleRoom` when one player is left: the pot lands in the winner's vault balance and skill fees go to the treasury. The result screen links the payout transaction. **TARIK** withdraws to the wallet.

## How a round works

1. **Hidden move (15 s):** walk to any tile and aim in one of 8 directions. Opponents are invisible. Optionally buy one skill.
2. **Shootout (5 s):** everyone is revealed and all shots resolve at the same time, one turn at a time on screen.
3. **Shrink:** from round 2 the outer ring sinks into the lava at the start of each round (down to 2×2); players on it are pushed inwards.
4. Last player standing wins the pot. If the last players eliminate each other, or 20 rounds pass, the pot is split between them. Skill fees go to the treasury, not the pot.

| Skill     | Cost (% of bid) | Cooldown | Effect                                                              |
| --------- | --------------- | -------- | ------------------------------------------------------------------- |
| Mine      | 15%             | 2        | Dropped on your current tile; explodes on an enemy that ends there. |
| Shotgun   | 25%             | 3        | Fires three ways: straight and ±45°.                                |
| Shield    | 25%             | 3        | No shooting this round; blocks shots from the direction you face.   |
| Gold helm | 40%             | 4        | Absorbs one hit, then falls off.                                    |

Board size follows the player count: 2–3 → 8×8, 4–6 → 10×10, 7–10 → 12×12.

## What is on-chain and what is not

| On Monad testnet                               | On the game server                       |
| ---------------------------------------------- | ---------------------------------------- |
| Test USDC faucet, vault deposit and withdrawal | Player positions, aim and moves          |
| Bid lock per room (`joinRoom`)                 | Round resolution (shots, mines, shields) |
| Game start (`startRoom`, no leaving after)     | Signing join tickets and settlements     |
| Pot payout and skill fees (`settleRoom`)       |                                          |
| Refund of every bid if a room is never settled |                                          |

Keeping positions off-chain is what makes "blind" possible: anything on a public chain could be read by the other players.

## Repository layout

```
dorprize/
├─ frontend/   Next.js 16 + React 19 + React Three Fiber game, lobby and wallet UI
├─ backend/    Node + Express + Socket.io game server (rooms, rounds, hidden positions, relayer)
├─ sc/         Foundry smart contracts: GameUSDC, USDCFaucet, GameVault, RoomManager
├─ shared/     @dorprize/game-core: rules, round engine, RoomRunner, Socket.io protocol
└─ docs/       PRD and rulebook
```

| Folder                         | Package               | Details                                          |
| ------------------------------ | --------------------- | ------------------------------------------------ |
| [frontend](frontend/README.md) | `@dorprize/frontend`  | Game client, wallet (Reown + wagmi), vault UI    |
| [backend](backend/README.md)   | `@dorprize/backend`   | Authoritative game server, wallet login, relayer |
| [sc](sc/README.md)             | `@dorprize/contracts` | Contracts, tests, deploy scripts, generated ABIs |
| [shared](shared/README.md)     | `@dorprize/game-core` | Game logic used by both frontend and backend     |

An **npm workspaces** monorepo: one `npm install` at the root links every package. Game rules live only in `shared/`, so the in-browser mock and the real server always behave the same.

## Run it yourself

Requires Node.js 20.9+ (22 recommended) and, for contracts, [Foundry](https://getfoundry.sh).

```bash
git clone --recurse-submodules https://github.com/alifrizqullahmaruf/DorPrize.git
cd DorPrize
npm install
cp frontend/.env.example frontend/.env.local
npm run dev                                    # http://localhost:3000
```

Already cloned without submodules? Run `git submodule update --init --recursive`.

The default `.env.local` is **demo mode**: no wallet, no backend. The room server runs in the browser with bots and a fake USDC balance, so the whole game can be tried in one step. URL flags: `?fast=1`, `?slow=1`, `?bots=N` (e.g. `/room/TEST01?fast=1&bots=5`).

### Multiplayer on your machine

```bash
# frontend/.env.local
NEXT_PUBLIC_GAME_TRANSPORT=socket
NEXT_PUBLIC_BACKEND_API_URL=http://localhost:3001
```

Run `npm run dev:all` (frontend on :3000, game server on :3001), open two different browsers, join the same room code and press **SIAP** in both. For solo testing start the backend with `ALLOW_BOTS=1` in `backend/.env`.

### Full on-chain mode

1. Deploy the contracts or reuse the ones above ([sc/README.md](sc/README.md)); `npm run sc:abi` writes the addresses the frontend reads.
2. `frontend/.env.local`: `NEXT_PUBLIC_DEMO_OFFLINE=0`, `NEXT_PUBLIC_ONCHAIN_BIDS=1`, `NEXT_PUBLIC_REOWN_PROJECT_ID=<id from cloud.reown.com>`, plus the socket settings above.
3. `backend/.env`: `ONCHAIN=1`. Start it with `npm run start:backend`: it asks for the password of the Foundry keystore that is RoomManager's `backendSigner`/`operator` and needs MON for gas. The key is never stored in a file.

| Command                           | What it does                                         |
| --------------------------------- | ---------------------------------------------------- |
| `npm run dev` / `build` / `start` | Run, build or serve the frontend                     |
| `npm run dev:backend`             | Game server with reload (guest mode)                 |
| `npm run start:backend`           | Game server (asks for the keystore when `ONCHAIN=1`) |
| `npm run dev:all`                 | Frontend + game server together                      |
| `npm run tunnel`                  | Expose the local game server with Cloudflare         |
| `npm run lint` / `typecheck`      | ESLint (frontend), TypeScript in every workspace     |
| `npm test`                        | Unit and integration tests (shared + backend)        |
| `npm run format` / `format:check` | Prettier                                             |
| `npm run sc:test`                 | Contract tests (Foundry)                             |
| `npm run sc:abi`                  | Build contracts and export ABIs/addresses            |
| `npm run sc:deploy`               | Deploy contracts to Monad testnet                    |

## Deployment

**Frontend (Vercel).** Import the repo with **Root Directory = `frontend`**, keep the default build settings and leave "Include files outside the Root Directory" on. `NEXT_PUBLIC_*` values are baked in at build time, so redeploy after changing them. The live site uses the custom domain `www.dorprize.xyz`.

**Game server.** It keeps WebSocket connections open, so it does not run on Vercel. For the Blitz demo it runs on a laptop behind a Cloudflare tunnel:

1. `backend/.env`: `CORS_ORIGINS=http://localhost:3000,https://dorprize.xyz,https://www.dorprize.xyz` and `ONCHAIN=1`, then `npm run start:backend`.
2. Second terminal: `npm run tunnel`, copy the `https://….trycloudflare.com` URL.
3. Vercel → Settings → Environment Variables: `NEXT_PUBLIC_GAME_TRANSPORT=socket`, `NEXT_PUBLIC_BACKEND_API_URL=<tunnel URL>`, `NEXT_PUBLIC_DEMO_OFFLINE=0`, `NEXT_PUBLIC_ONCHAIN_BIDS=1`, `NEXT_PUBLIC_REOWN_PROJECT_ID=<id>`, then **Redeploy**.
4. Keep both terminals running; a quick tunnel gets a new URL on every restart. Any Node host with WebSockets (Railway, Render, Fly.io) works the same way with a fixed URL.

## Controls

Over-the-shoulder camera while playing; isometric view in the lobby and when spectating.

- **Desktop:** click once to capture the mouse; the mouse aims (snapped to 8 directions) and tilts the camera. **WASD / arrows** walk to any tile still standing. **F** holds fire, **1–4** buy skills, **Esc** releases the mouse, ⚙ sets sensitivity and sound. Moves lock automatically when the timer ends.
- **Mobile:** left joystick to walk, drag to aim.

## Security notes

- Contracts are UUPS proxies (OpenZeppelin 5.6.1) with pause, a refund path if a room is never settled and one-time settlement per room. 34 Foundry tests including a vault solvency fuzz test.
- The deployer and server keys live in an encrypted Foundry keystore; no private key is stored in the repo or in `.env` files.
- This is a hackathon build on testnet: the backend is trusted to sign tickets and settlements, and contracts are owned by a single key. A multisig and timelock would come before mainnet.

## Assets

All voxel models and textures are drawn in code (no Minecraft assets) and sound effects are synthesized with Web Audio. Inspired by the Roblox game Blind Shot; the betting and settlement architecture follows [PassChick](https://github.com/wngstnr-code/pass-chick).
