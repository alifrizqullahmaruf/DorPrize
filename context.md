# DorPrize — Context implementasi

Terakhir diperbarui: 24 Oktober 2026 (WIB).

## Instruksi pengguna

- Task terbaru: ambil repo GitHub terbaru, perbaiki backend/smart contract yang dapat dikerjakan tanpa konfigurasi produksi, uji lokal, kemudian commit/push. Pengguna telah mengizinkan push setelah pengujian selesai.
- Checkout aktif sekarang `DorPrize-current/`, branch `codex/native-backend`. Berawal dari main baru `080c2c2`, kemudian direbase ke `744ef45` yang masuk selama pengerjaan. Perubahan UI dan legacy kontrak upstream dipertahankan. Riwayat GitHub telah di-force-update dan struktur berubah menjadi `frontend/`, `backend/`, `shared/`, `sc/`. Checkout `DorPrize/` lama dipertahankan utuh sebagai cadangan dan bukan target push.
- Explorer yang diberikan pengguna: `https://testnet.monadvision.com/`. Handoff deployment hanya memuat alamat kontrak/chain/RPC publik/ABI/explorer; tidak pernah private key.

- Kerjakan smart contract dengan source UI dari `git@github.com:alifrizqullahmaruf/DorPrize.git`.
- Wallet produk memakai MetaMask; chain Monad Testnet (10143); aset MON native, bukan USDC.
- Gunakan MONSKILLS. Mulai dari `monskill`; panduan addresses, gas, scaffold, tooling sudah dibaca. Dokumentasi resmi terbaru mengatasi parameter skill yang kedaluwarsa.
- **Perbarui `context.md` setiap task/checkpoint penting**: perubahan, pengujian, batasan, dan langkah berikutnya.
- Task lanjutan: integrasi kontrak dan validasi backend dahulu. UI sedang diperbagus teman pengguna; jangan mengubah source UI.
- Domain frontend: `https://dorprize.vercel.app`. Alamat MetaMask publik pengguna: `0x50463168EBC5ae0Ed86efcA496b9A7A4495F7109` (format valid; belum otomatis ditetapkan sebagai owner/treasury/operator/signer).

## Kebutuhan dan cakupan

Acuan native yang tersedia di repo ini: `sc/NATIVE_MON.md` dan `backend/NATIVE_BACKEND.md`, beserta keputusan di context ini. `docs/PRD.md` masih memuat spesifikasi prototipe USDC. PRD MON yang dipakai saat pengerjaan tersimpan di workspace induk MONAD dan tidak boleh tertukar dengan spesifikasi legacy tersebut.

- 2–10 pemain. Bid minimum 1 MON, custom pecahan diperbolehkan.
- Kontrak mengurus saldo/escrow/payout/refund. Server menentukan hasil; resultHash bukan bukti kebenaran game.
- Biaya skill di luar pot: 15%/25%/25%/40%, pembulatan harga 0,01 MON; dibayar ke treasury saat settlement dari budget yang dicadangkan saat join.
- Payout seri dibulatkan turun ke 0,01 MON. Pemenang tunggal menerima seluruh pot.
- Kebijakan penerima akhir dust belum diputuskan; implementasi sementara mencatat dust sebagai kewajiban terpisah tanpa fungsi sweep/withdraw.

## Temuan source

- Repo sudah berisi UI, backend gameplay dan kontrak legacy USDC UUPS (`GameVault`, `RoomManager`, token/faucet).
- Pada audit awal, UI memakai deposit ERC-20, 6 desimal, Reown dan backend belum punya SIWE/ticket/relayer/persistence. Backend native sekarang tersedia dalam mode terpisah; UI tetap belum dimigrasikan.
- Tambahkan kontrak native terpisah, `NativeGameVault`, agar ABI legacy dan UI tetap dapat dibuild. Ini deployment baru, bukan upgrade proxy lama.
- Tidak mengubah UI/backend game pada task kontrak ini; sediakan ABI/helper/dokumentasi integrasi native.

## Progres per task

1. **Selesai — audit source/setup:** clone repo; dependency sesuai lockfile terpasang (`npm ci --ignore-scripts`). Foundry v1.8.6 Windows resmi di `../tmp/foundry-v1.8.6/`; SHA-256 archive diverifikasi terhadap rilis resmi. Paket npm awal v1.7.1 tidak mendukung mode Monad dan tidak lagi menjadi tool validasi akhir. Wrapper npm awal juga gagal pada sintaks postinstall Windows.
2. **Selesai — implementasi awal NativeGameVault:** MON payable; pemisahan available/bid/skill/treasury/dust; EIP-712 ticket dengan nonce/chain/vault/budget; satu room aktif per wallet; roster hash saat start; settlement sekali; cancel lobi dan permissionless refund ACTIVE setelah 15 menit; withdraw dengan reentrancy guard; non-upgradeable dengan Ownable2Step.
3. **Lulus — unit/fuzz test awal:** `forge test --match-contract NativeGameVaultTest -vv`: 31 test lulus, 0 gagal; termasuk fuzz 256 input, replay lintas chain/vault, reentrancy, batas expiry, dust, isolasi room dan fee budget. Compiler awal mengalami stack-too-deep; loop fee dipisah menjadi helper, build normal berhasil tanpa via-IR. Ini test EVM lokal; belum test deployment Monad.
4. **Lulus — seluruh Foundry test mode Monad:** Foundry v1.8.6 `forge test --network monad -vv`: 63 test/suite checks lulus, 0 gagal (31 native unit/fuzz, 31 legacy, 1 stateful invariant campaign). Dua invariant diperiksa dalam 128 runs ×64 panggilan =8.192 calls, 0 reverts. Runtime NativeGameVault 11.761 byte pada build awal. Tidak menganggap angka gas Ethereum sebagai estimasi Monad.
5. **Selesai — ABI/helper/deployment preparation:** ABI native diekspor terpisah; `@dorprize/contracts/native` menyediakan typed data tiket, harga skill, payout dan roster hash. `DeployNative.s.sol` menerima alamat role eksplisit dan hanya chain 10143/31337; tidak menulis alamat saat simulasi. Recorder memeriksa receipt creation, bytecode, schema dan role; testnet juga mensyaratkan finality. Alamat native production masih kosong.
6. **Lulus final — helper dan TypeScript:** 6 test helper lulus, mencakup matrix harga 1/2/5/10 MON, half-up, dust, sub-cent winner dan domain tiket. `npm run typecheck` seluruh workspace (server/web/contracts/game-core) lulus. Root export legacy tetap dapat dikompilasi frontend.
7. **Lulus final — integrasi lokal:** viem/Anvil mode Monad berhasil menjalankan deposit→join→start→settle→withdraw, treasury, kesesuaian typed-data/roster hash TypeScript↔Solidity, serta pencatatan receipt deployment. Script `DeployNative.s.sol` juga berhasil broadcast ke Anvil localhost dengan akun development publik. Perbandingan alamat checksum di test sudah diperbaiki. Sandbox localhost memerlukan eksekusi test dengan izin network lokal. Tidak ada transaksi testnet.
8. **Selesai — dokumentasi dan perintah:** panduan `sc/NATIVE_MON.md`, `.env.native.example`, README dan AGENTS.md tersedia. Default `contracts:deploy` / `deploy:monad` / `deploy:local` sekarang memilih native MON. Deploy USDC lama dipisah ke `deploy:legacy:*`. ABI production native masih kosong; record Anvil diabaikan Git/export.
9. **Lulus — pemeriksaan akhir:** ABI generation, format Solidity/TypeScript/Markdown dan `git diff --check` lulus. Perubahan test `vm.getChainId()` diuji ulang khusus. Foundry build juga menampilkan lint heuristik (deadline timestamp, pembulatan sengaja, loop validasi dan helper transfer) serta warning cache signature di sandbox; tidak ada kegagalan compiler/test. Unit/invariant bukan audit independen.
10. **Selesai — integrasi backend native:** `SERVER_MODE=native` memilih backend baru di `backend/src/native`. SIWE server-generated challenge sekali pakai (5 menit), bearer session 1 jam, pemeriksaan sesi setiap packet, identitas socket dari wallet terverifikasi. HTTP/socket origin allowlist mencakup domain frontend pengguna. Mode demo guest lama tetap tersedia; tidak ada source `frontend` yang diubah.
11. **Selesai — validasi chain dan uang:** startup memeriksa chain/bytecode finalized/schema native/role signer dan operator; tiket memeriksa available balance/nonce/capacity. Join socket memerlukan finalized escrow membership. Countdown membekukan mutasi lobi, memeriksa seluruh roster siap, mengonfirmasi start onchain, lalu memeriksa ulang cadangan sebelum engine berjalan. Skill dibatasi budget integer wei dan cooldown; input memiliki round/actionId/seq/ACK, replay identik idempoten, perubahan dan ronde lama ditolak, deadline native tanpa grace. Biaya/payout settlement memakai bigint terpisah dari numeric display engine legacy.
12. **Selesai — persistence dan recovery:** adapter PostgreSQL/Supabase dengan advisory single-writer lock; alternatif journal file lokal dengan lock/fsync/atomic replacement. State bound ke chain+vault. Hasil dan pending settlement intent disimpan atomik sebelum broadcast; raw transaksi operator/hash disimpan sebelum dikirim dan dipakai ulang untuk rekonsiliasi nonce. Private round audit tersimpan server-only. Restart melanjutkan hasil final, membatalkan lobi lama, dan merefund match aktif yang kehilangan state setelah expiry 15 menit. Dust tetap terpisah. Akun operator harus khusus backend agar nonce tidak berbenturan.
13. **Lulus — validasi backend lokal:** 47 test game-core dan 19 test server/auth/journal lulus; integrasi native Anvil Monad lulus 6 skenario + 1 suite induk (7 checks): auth/identitas palsu, escrow/ticket, roster/budget/replay, settle/withdraw, restart setelah receipt sudah mined tetapi status job pending, cancel lobi, serta refund ACTIVE setelah timeout. Alur 2 wallet deposit→join→game→settle→withdraw nyata di localhost. Uji ulang Foundry mode Monad: 63 checks lulus termasuk invariant 8.192 calls. Setelah penambahan audit log privat, test core/server, integrasi native dan typecheck seluruh workspace kembali lulus; persistensi audit ronde juga diperiksa di integrasi. Format dan diff check lulus. Akses localhost memerlukan izin network karena sandbox awal menghasilkan EACCES.
14. **Selesai — panduan handoff:** `backend/NATIVE_BACKEND.md` dan `.env.native.example` berisi konfigurasi backend, REST/socket native, urutan integrasi frontend dan batas readiness. Dependency pg/@types/pg/viem ditambahkan pada server; patch kompatibel body-parser diterapkan setelah laporan DoS, hasil npm install/update terakhir melaporkan 0 vulnerabilities untuk graph workspace server. Audit seluruh repo sebelumnya juga menampilkan advisory transitive di stack UI Reown/SDK; tidak menjalankan upgrade UI di luar cakupan.

## Menjalankan ulang pada host saat ini

Checkpoint final 24 Oktober 2026: native contract/backend dipindahkan ke struktur terbaru dan direbase ke `744ef45`; diff `frontend/` terhadap main kosong. Submodule Solidity upstream dipertahankan. Recovery operator diperbaiki agar pending transaction yang finalized revert tidak menghentikan startup/job room lain. Journal file mengambil snapshot saat `put` dipanggil dan menolak struktur state rusak. PostgreSQL bootstrap transaksional mengaktifkan RLS dan mencabut akses PUBLIC/anon/authenticated, serta membersihkan koneksi jika startup gagal. Endpoint `/ready` memeriksa journal/RPC. Instalasi bersih `npm ci` selesai. Validasi akhir: 66 checks Foundry Monad termasuk 8.192 invariant calls, 47 test game-core, 20 test backend/auth/journal, 6 helper ekonomi, 1 integrasi kontrak/recorder/deploy script, 8 checks native Anvil, dan 4 checks PostgreSQL nyata lulus. Typecheck seluruh workspace, format Solidity/Prettier, ABI generation, dan diff check lulus. Handoff recorder memeriksa canonical receipt dan mengekspor lima detail publik; explorer memakai MonadVision testnet. Perintah native deploy/verify dibedakan dari legacy, termasuk RPC khusus native dari MONAD_RPC_URL dan keystore legacy terbaru. CI Linux/Windows ditambahkan; hasil CI remote belum diperiksa. Commit implementasi `fdb6b59` berhasil dipush ke `origin/codex/native-backend`. Dust tidak diubah dan belum ada transaksi testnet.

Tambahkan folder `../tmp/foundry-v1.8.6` ke PATH shell, atau gunakan binary absolutnya. `ANVIL_BIN` dan `FORGE_BIN` dapat dipakai oleh integration test bila tool belum ada di PATH.

```text
npm run test:monad -w @dorprize/contracts
npm run test:helpers -w @dorprize/contracts
npm run test:integration -w @dorprize/contracts
npm run sc:abi
npm test
npm run test:native -w @dorprize/backend
npm run typecheck
```

Source baru utama: `sc/src/NativeGameVault.sol`. API frontend/backend: `@dorprize/contracts/native`. Native vault non-upgradeable dengan treasury immutable; tidak boleh di-upgrade ke proxy USDC lama.

## Berikutnya

- **Kontrak dan integrasi backend lokal selesai, teruji dan sudah dipush** ke branch `codex/native-backend` (commit implementasi `fdb6b59`). Main tidak diubah oleh push ini dan belum ada PR. Lanjutkan dari panduan `backend/NATIVE_BACKEND.md`.
- Teman pengguna menangani UI; handoff memakai native API, MetaMask, 18 desimal dan ABI native. Jangan menyamakan deployment web Vercel dengan kesiapan backend/kontrak native.
- Deployment jaringan/verifikasi explorer/hosting backend belum dilakukan. Diperlukan assignment role owner/operator/backendSigner/treasury, signer deployment dan server yang disimpan aman, MON testnet operator, serta RPC proyek. Alamat publik wallet saja tidak memberikan otoritas signing. Tidak ada transaksi ke testnet.
- PostgreSQL adapter sudah diuji pada server PostgreSQL nyata sementara di localhost. Database produksi belum dihubungkan karena DATABASE_URL belum tersedia; uji game end-to-end memakai journal file lokal. Gunakan connection role server yang memiliki tabel journal, direct/session URL dan satu replica backend.
- Tentukan kebijakan penerima/claim dust sebelum distribusi seluruh pot dianggap tuntas. Versi saat ini sengaja tidak menyediakan dust sweep/withdraw; semua dust tetap liability terpisah.
