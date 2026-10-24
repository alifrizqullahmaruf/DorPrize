# Handoff native MON testnet — 24 Oktober 2026

Semua perubahan berada di `codex/native-backend`. Pengguna mengizinkan perubahan
logika MetaMask, login, MON dan transaksi sambil mempertahankan tampilan game.
Branch `main` dan deployment frontend publik belum diperbarui.

## Kontrak dan hasil uji

| Parameter | Nilai |
| --- | --- |
| Network | Monad Testnet, chain ID `10143` |
| Aset | MON native, 18 desimal |
| NativeGameVault | `0xEBAe4367eeDcaEfd839BaC833ac10574ae094537` |
| Owner / treasury | `0x50463168EBC5ae0Ed86efcA496b9A7A4495F7109` |
| Operator / deployer | `0x5EaD190F2786362c556B9BF4798326d6e11b88F2` |
| Backend signer | `0xF262fd0A43B499389b5d6ef6153e2A710685349b` |
| RPC publik | `https://testnet-rpc.monad.xyz` |
| ABI | `@dorprize/contracts/native` |

[Deployment](https://testnet.monadvision.com/tx/0x2e4c72c4082bb4161778f32b342f04cf4d4093022cba904eef1e1da19031477b)
berhasil dan finalized di blok 73763251; biaya aktual 0,311024928 MON testnet.
Bytecode dan role diperiksa; verifikasi Sourcify menghasilkan `match`.
[Registry publik](../sc/deployments/native/10143.json) tidak memuat secret.

Uji live dua wallet diizinkan pengguna, masing-masing didanai 1,3 MON testnet.
Masing-masing deposit 1 MON, login SIWE, menerima tiket, join escrow, bermain
melalui Socket.io dan menyelesaikan settlement pot 2 MON dengan dust nol.
Pemenang melakukan withdraw; sisa yang dapat dikirim dikembalikan ke wallet
pendana, setelah gas dan cadangan kecil untuk sweep. Saldo backend signer
setelah uji: 4,913968188 MON. Tidak ada escrow uji aktif tersisa.

[Settlement](https://testnet.monadvision.com/tx/0x63fcd3af26529e71f8fd090a35949a76b716147abf4d3f29189047c7b68c56df)
dan seluruh hash transaksi tersedia di [bukti publik](native-testnet-smoke.json).
Ini menguji signature/API/socket dan transaksi aktual. Klik MetaMask dari dua
browser frontend masih perlu diperiksa setelah deployment frontend preview.

## Backend gratis dan preview lokal

Backend lokal terakhir terverifikasi ready di `http://localhost:3001`, dengan
origin login `http://localhost:3000`. Preview frontend produksi memakai backend
lokal tersebut. Endpoint `/ready` memberi HTTP 200 dengan `mode: native`,
`chainId: 10143`. Proses ini juga sedang dipakai chat demo lain; jangan restart
tanpa memeriksa tidak ada match aktif.

Cloudflare Quick Tunnel tanpa kartu berhasil dipakai pada uji live; alamat
`https://fastest-menus-daughters-lung.trycloudflare.com` pada bukti uji adalah
alamat historis. Tunnel kemudian berhenti/berubah, sehingga alamat itu bukan
URL aktif yang boleh dibagikan sebagai demo sekarang. Untuk akses dari internet,
jalankan kembali tunnel dan ambil URL aktual dari status runtime. Laptop,
Node dan tunnel harus tetap aktif; URL berubah bila tunnel dibuat ulang.
Ini bukan hosting cloud permanen. Render meminta verifikasi kartu dengan
otorisasi sementara USD1 meski paket Free dipilih; tidak ada service Render
dibuat atau pembayaran dilakukan.

Supabase session pooler telah terhubung dengan TLS terverifikasi, RLS privat
dan advisory single-writer lock. Gunakan satu proses backend. Jangan menjalankan
instance cloud lain bersamaan dengan proses lokal pada database yang sama.
Secret tetap di file `.env` lokal yang diabaikan Git; jangan memasukkan key server
atau database ke environment `NEXT_PUBLIC_*`.

Di PowerShell pada root checkout ini:

```powershell
powershell -NoProfile -File scripts/native-demo.ps1 status
# Hanya mulai jika proses lama sudah berhenti:
powershell -NoProfile -File scripts/native-demo.ps1 start
# Hentikan di antara match, bukan ketika pemain sedang bermain:
powershell -NoProfile -File scripts/native-demo.ps1 stop
```

Script membutuhkan `backend/.env` dan binary Cloudflare resmi di
`../tmp/cloudflared/cloudflared.exe`. Runtime lokal mencatat PID, executable dan
waktu mulai, agar script tidak menghentikan proses lain yang memakai ulang PID.
Perintah status, stop dan startup sudah diperiksa pada host. Ditemukan dan
diperbaiki pembacaan log tunnel kosong dan penantian proses berhenti. Siklus
akhir stop/start tidak diulang setelah chat demo lain mengambil runtime yang sama.
Stop Windows mengakhiri proses; match aktif menggunakan recovery/refund expiry
yang sudah diimplementasikan. Setelah restart, salin URL baru ke frontend lalu
build/deploy ulang karena environment publik Next dibekukan saat build.

## Frontend native pada branch ini

Salin `frontend/.env.native.example` ke `frontend/.env.local` dan isi URL backend.
Konfigurasi contoh:

```dotenv
NEXT_PUBLIC_ASSET_MODE=native
NEXT_PUBLIC_DEMO_OFFLINE=0
NEXT_PUBLIC_GAME_TRANSPORT=socket
NEXT_PUBLIC_BACKEND_API_URL=http://localhost:3001
NEXT_PUBLIC_NATIVE_GAME_VAULT_ADDRESS=0xEBAe4367eeDcaEfd839BaC833ac10574ae094537
NEXT_PUBLIC_MONAD_CHAIN_ID=10143
NEXT_PUBLIC_MONAD_RPC_URLS=https://testnet-rpc.monad.xyz
```

MetaMask memakai injected connector; Reown project ID tidak diperlukan pada mode
native. Login memeriksa wallet, chain, domain, URI dan expiry challenge sebelum
meminta signature. Deposit/withdraw memakai MON payable dan integer wei.
Join menampilkan bid ditambah budget skill sebelum transaksi escrow. Budget 0
berarti tanpa skill berbayar. Hasil hadiah menunggu settlement terkonfirmasi.

`AUTH_ORIGIN` runtime backend saat pemeriksaan terakhir `http://localhost:3000`;
file `.env` dapat berbeda karena process environment dapat meng-override nilainya.
Periksa `/config` untuk konfigurasi efektif. Untuk menjalankan preview Vercel,
ubah `AUTH_ORIGIN` ke origin aktual itu dan tambahkan ke `CORS_ORIGINS`, lalu
restart backend di antara match. Frontend publik memerlukan URL backend HTTPS
dari tunnel atau hosting yang aktif. Challenge
untuk domain lain sengaja ditolak. Jangan mengarahkan deployment main teman
ke kode ini; pilih branch `codex/native-backend` untuk preview.

```sh
npm run typecheck
npm run test:frontend:native
npm run lint
npm run build -w @dorprize/frontend -- --webpack
npm run start -w @dorprize/frontend
```

Build Turbopack Windows berulang kali gagal saat worker CSS berhenti sebelum
tersambung. Build produksi Webpack dengan plugin PostCSS Tailwind standar
berhasil. Mode demo/adapter legacy tetap tersedia bila flag native tidak aktif.
Verifikasi saat ini meliputi 33 test native Foundry, startup/auth Supabase live,
uji dua wallet testnet, serta validasi frontend precision dan challenge SIWE.
Ini tidak menggantikan audit independen atau uji interaktif MetaMask frontend.
