# @dorprize/frontend

DOR PRIZE web client: Next.js 16 (App Router, Turbopack), React 19, React Three Fiber, Tailwind v4 and zustand.

```bash
cp .env.example .env.local   # demo mode by default
npm run dev                  # from this folder, or `npm run dev` from the root
```

## Structure

```
src/
├─ app/            Routes: / (menu), /play (pick a room), /room/[id] (lobby + game)
├─ features/
│  ├─ game/        3D scene, HUD, controls, state and networking (mock + Socket.io)
│  ├─ room/        Create / browse rooms, QR scan, lobby
│  ├─ menu/        Main menu
│  └─ wallet/      Demo wallet, Reown + wagmi, Vault, player profile
└─ shared/         Cross-feature UI, audio, hooks, backend client, providers
```

Use the `@/` alias for imports inside this app (e.g. `@/features/game/state/store`). Game rules and protocol types come from `@dorprize/game-core`; contract ABIs and addresses from `@dorprize/contracts`.

## Environment

| Variable                       | Purpose                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_GAME_TRANSPORT`   | `mock` (in-browser server + bots) or `socket` (the backend)                                   |
| `NEXT_PUBLIC_DEMO_OFFLINE`     | `1` = fake USDC balance in the browser; `0` = real wallet + contracts                         |
| `NEXT_PUBLIC_ONCHAIN_BIDS`     | `1` = wallet login, bids locked in RoomManager, pot paid on-chain (needs backend `ONCHAIN=1`) |
| `NEXT_PUBLIC_BACKEND_API_URL`  | Game server URL in socket mode, e.g. `http://localhost:3001`                                  |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Reown (WalletConnect) project id                                                              |
| `NEXT_PUBLIC_MONAD_*`          | Chain settings (defaults: Monad testnet)                                                      |
| `NEXT_PUBLIC_*_ADDRESS`        | Optional overrides; by default addresses come from `sc/deployments`                           |

See the root [README](../README.md) for run modes and Vercel deployment.
