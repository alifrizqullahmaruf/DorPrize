# DOR PRIZE

Game tembak "buta" di arena lava untuk 2–10 pemain, dibuat untuk **Monad Blitz #2**. Pemain terakhir yang bertahan mengambil seluruh pot USDC (testnet). Spesifikasi produk ada di [docs/PRD.md](docs/PRD.md).

## Struktur repo

Repo ini adalah monorepo **npm workspaces**:

```
dorprize/
├─ apps/
│  ├─ server/                 Server game Node + Express + Socket.io (room, ronde, rahasia posisi)
│  └─ web/                    Frontend Next.js 16 + React 19 + Three.js (React Three Fiber)
│     ├─ public/              Aset statis (logo)
│     └─ src/
│        ├─ app/              Route: / (menu), /play (pilih room), /room/[id] (lobi + game)
│        ├─ features/
│        │  ├─ game/          Game: scene 3D, HUD, kontrol, state, jaringan (mock + Socket.io)
│        │  ├─ room/          Pilih/buat room, scan QR, lobi
│        │  ├─ menu/          Main menu
│        │  └─ wallet/        Dompet demo, Reown/wagmi, Vault, profil pemain
│        └─ shared/           Dipakai lintas fitur: UI, audio, hooks, klien backend, providers
├─ packages/
│  ├─ game-core/              Protokol Socket.io, aturan, geometri grid, engine ronde, RoomRunner
│  │                          (siklus room), bot + unit test. Dipakai frontend (mock) dan server.
│  └─ contracts/              Smart contract Foundry: GameUSDC, USDCFaucet, GameVault, RoomManager
│                             (+ ABI TypeScript hasil generate untuk frontend/backend)
└─ docs/                      PRD, rulebook, gambar referensi
```

Aturan import:

- Di dalam `apps/web`, gunakan alias `@/` (mengarah ke `apps/web/src`), misalnya `@/features/game/state/store`.
- Semua yang menyangkut aturan atau protokol game diimpor dari `@dorprize/game-core`.

## Menjalankan

Butuh Node.js 20.9+.

```bash
npm install                                   # dari root repo
cp apps/web/.env.example apps/web/.env.local  # default: mode demo + mock server
npm run dev                                   # http://localhost:3000
```

| Perintah                          | Fungsi                                        |
| --------------------------------- | --------------------------------------------- |
| `npm run dev` / `build` / `start` | Menjalankan, build, atau serve aplikasi web   |
| `npm run dev:server`              | Server game Socket.io (http://localhost:3001) |
| `npm run dev:all`                 | Web + server game sekaligus                   |
| `npm run lint`                    | ESLint aplikasi web                           |
| `npm run typecheck`               | TypeScript di semua workspace                 |
| `npm test`                        | Test game-core + server game                  |
| `npm run format` / `format:check` | Prettier                                      |
| `npm run contracts:test`          | Test smart contract (Foundry)                 |
| `npm run contracts:abi`           | Build kontrak + ekspor ABI/alamat ke frontend |
| `npm run contracts:deploy`        | Deploy kontrak ke Monad testnet               |

Secara bawaan game bisa dimainkan penuh **tanpa backend dan tanpa wallet**:

- `NEXT_PUBLIC_GAME_TRANSPORT=mock` menjalankan server tiruan di browser, lengkap dengan bot.
- `NEXT_PUBLIC_DEMO_OFFLINE=1` menyimpan saldo USDC tiruan di browser. Tombol Faucet memberi +100.

Flag URL untuk testing di mode mock:

- `?fast=1` membuat semua fase 0,4× lebih cepat, `?slow=1` membuatnya 3× lebih lambat.
- `?bots=N` mengatur jumlah bot.
- Contoh: `/room/TEST01?fast=1&bots=5`. Kode room yang belum ada akan dibuat otomatis.

## Multiplayer lokal (server Socket.io)

Untuk bermain sungguhan antar-browser, jalankan server game di [apps/server](apps/server/README.md):

1. Di `apps/web/.env.local` set `NEXT_PUBLIC_GAME_TRANSPORT=socket` dan `NEXT_PUBLIC_BACKEND_API_URL=http://localhost:3001`.
2. `npm run dev:all` (web di :3000, server di :3001).
3. Buka dua jendela browser yang berbeda (misalnya biasa + incognito), karena ID tamu disimpan per browser. Buat room di salah satunya, masuk dengan kode room yang sama di jendela lain, lalu keduanya tekan Ready.

Ingin mencoba sendirian? Jalankan server dengan bot: salin `apps/server/.env.example` ke `apps/server/.env` lalu set `ALLOW_BOTS=1`.

## Mode on-chain + backend asli

Isi `apps/web/.env.local`:

1. Isi `NEXT_PUBLIC_REOWN_PROJECT_ID` (dari cloud.reown.com), lalu set `NEXT_PUBLIC_DEMO_OFFLINE=0`.
2. Deploy kontrak (lihat [packages/contracts/README.md](packages/contracts/README.md)) lalu jalankan `npm run contracts:abi`: frontend otomatis memakai alamat di `deployments/10143.json`. Variabel `NEXT_PUBLIC_*_ADDRESS` hanya perlu diisi untuk menimpa alamat itu.
3. Set `NEXT_PUBLIC_GAME_TRANSPORT=socket` dan isi `NEXT_PUBLIC_BACKEND_API_URL`. Integrasi on-chain di server (SIWE, tiket `joinRoom`, relayer `startRoom`/`settleRoom`) belum dikerjakan; saat ini server memakai ID tamu.

Lapisan wallet ada di `apps/web/src/features/wallet/` dan diadaptasi dari [PassChick](https://github.com/wngstnr-code/pass-chick). Isinya Reown AppKit + wagmi 3, login SIWE dengan cookie, serta deposit, tarik, dan faucet ke GameVault.

## Deploy ke Vercel

1. Import repo di Vercel dan set **Root Directory = `apps/web`**. Framework terdeteksi otomatis sebagai Next.js.
2. Biarkan Build, Output, dan Install Command bawaan. Vercel menginstal npm workspaces dari root repo, dan opsi "Include files outside the Root Directory" harus tetap menyala.
3. Environment Variables boleh kosong: game berjalan dalam mode demo (mock server + bot, dompet USDC tiruan di browser).
4. Untuk mode sungguhan, isi env dari bagian di atas lalu **Redeploy**, karena `NEXT_PUBLIC_*` ditanam saat build. Backend Socket.io perlu di-host di luar Vercel (misalnya Railway, Render, atau Fly.io), dan domain Vercel harus diizinkan di CORS backend serta di dashboard Reown.

## Kontrak dengan tim backend

Semua event Socket.io didefinisikan di [packages/game-core/src/protocol.ts](packages/game-core/src/protocol.ts). Server ([apps/server](apps/server)) dan mock di browser ([mockTransport.ts](apps/web/src/features/game/net/mockTransport.ts)) sama-sama menjalankan `RoomRunner` dari `@dorprize/game-core`, jadi bentuk data dan waktunya identik.

| Event                                                | Arah            | Catatan                                                                                                |
| ---------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `room:join`, `room:skin`, `room:ready`, `room:leave` | client → server |                                                                                                        |
| `round:submit`                                       | client → server | `{ moveTo, shootDir, skill, mineAt }`, dikirim otomatis saat waktu ronde habis                         |
| `room:state`                                         | server → client | Tanpa posisi pemain                                                                                    |
| `round:start`                                        | server → client | Hanya posisi, cooldown, dan ranjau milik penerima; `shrunkRing`, `pushed`                              |
| `round:resolve`                                      | server → client | `revealed[]` berisi posisi semua pemain saat adu tembak. `shots[].paths[].from` adalah petak penembak. |
| `game:end`                                           | server → client | Pemenang, payout, `skillFees`, `kills`                                                                 |

Endpoint REST:

- `GET /health` status server.
- `GET /rooms` mengembalikan daftar room publik yang masih di lobi.
- `POST /rooms` membuat room (`{ name, bid, maxPlayers, isPrivate }` → `{ roomId }`).
- Belum ada: `POST /rooms/:id/ticket` mengembalikan `{ ticket }` untuk `joinRoom`.
- `POST /api/game/submit-settlement` untuk klaim hadiah, mengikuti pola PassChick.

Resolver ronde ada di [packages/game-core/src/engine.ts](packages/game-core/src/engine.ts).

## Kontrol

Selama bermain, kamera berada di belakang bahu karakter (gaya "shift lock" Roblox). Di lobi dan setelah tereliminasi, kamera kembali ke tampilan isometrik untuk menonton.

**Desktop:**

- **Klik sekali** ("KLIK UNTUK MAIN") untuk menyerahkan mouse ke game. Setelah itu gerakan mouse langsung memutar kamera tanpa drag: kiri-kanan untuk arah (di-snap 8 arah), atas-bawah untuk tinggi kamera. Sensitivitas bisa diatur lewat tombol ⚙.
- **WASD / panah** untuk jalan bebas relatif kamera, ke petak mana saja yang masih ada.
- Tidak ada tombol kunci. Posisi, arah, dan skill **terkunci otomatis saat waktu ronde habis**.
- **F** untuk tidak menembak, **1–4** untuk skill, **Esc** untuk melepas mouse.

**HP:** joystick di kiri untuk jalan, dan geser layar untuk memutar kamera/bidik.

## Aturan yang berbeda dari PRD awal

**Arena**

- Ukuran papan mengikuti jumlah pemain: 2–3 pemain 8×8, 4–6 pemain 10×10, 7–10 pemain 12×12.
- Di awal setiap ronde setelah ronde 1, cincin terluar tenggelam sampai tersisa 2×2.
- Lava tidak membunuh. Pemain di cincin yang tenggelam didorong ke dalam, dan ranjau di cincin itu hancur.
- Saat adu tembak, posisi semua pemain diungkap. Posisi disembunyikan lagi di ronde berikutnya, dan pemain yang tertembak hilang dari papan.

**Skill**

| Skill     | Cooldown | Aturan                                                                                                       |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| Ranjau    | 2        | Dipasang di petak yang diinjak **saat membeli** (`mineAt`). Meledak bila lawan berakhir di petak itu.        |
| Shotgun   | 3        | Tembak 3 arah: lurus dan ±45°.                                                                               |
| Tameng    | 3        | Pemakai **tidak menembak**. `shootDir` hanya arah hadap yang dilindungi dari depan.                          |
| Helm Emas | 4        | Sekali pakai: tetap terpasang sampai kena, menyerap 1 serangan, lalu jatuh. Bisa beli lagi setelah cooldown. |

## Catatan aset

Semua model dan tekstur voxel digambar dari kode, tanpa aset Minecraft. Efek suara disintesis dengan Web Audio. Video referensi gameplay Blind Shot (`docs/reference/*.mp4`) hanya disimpan lokal dan tidak masuk git karena ukurannya besar.

# DorPrize
# DorPrize
