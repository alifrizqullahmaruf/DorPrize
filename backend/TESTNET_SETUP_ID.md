# Persiapan Monad Testnet untuk DOR PRIZE

Kontrak dan backend telah diuji lokal. Belum ada deployment kontrak native atau
backend live yang dikonfirmasi. Frontend tetap dikerjakan teman pengguna.

## Wallet dan aturan pembagian

Owner yang sudah dikonfirmasi:
`0x50463168EBC5ae0Ed86efcA496b9A7A4495F7109`.

Wallet tambahan yang diberikan:
`0x5EaD190F2786362c556B9BF4798326d6e11b88F2`.

Usulan untuk testnet, belum merupakan konfigurasi onchain:

| Peran                      | Wallet                                                              |
| -------------------------- | ------------------------------------------------------------------- |
| Owner                      | Alamat lama, sudah dikonfirmasi                                     |
| Deployer dan treasury      | Dapat memakai alamat lama                                           |
| Operator transaksi backend | Wallet baru                                                         |
| Backend signer tiket       | Disarankan satu wallet tambahan; MVP dapat memakai wallet baru juga |

Jadi **tidak wajib menambah wallet untuk MVP**, tetapi **disarankan satu lagi**
untuk memisahkan operator dan backend signer. Kedua peran server memang boleh
memakai alamat yang sama; pemisahan membatasi dampak kebocoran satu kredensial.
Owner tetap di MetaMask/keystore pengguna. Hanya akun server yang kredensialnya
disimpan sebagai secret backend. Jangan memakai akun operator untuk transaksi
manual ketika backend berjalan, karena nonce dikelola relayer.

Demo memerlukan minimal dua pemain. Mereka boleh memakai wallet pemain yang
sudah ada, termasuk wallet teman; ini bukan tambahan peran admin wajib.

Semua pot dibagi rata dalam wei. Jika pembagian menyisakan kurang dari jumlah
pemenang, masing-masing pemenang awal pada roster saat start menerima tambahan
1 wei sampai habis. Selisih maksimal 1 wei. Tidak perlu random atau klaim dust
terpisah; tidak ada pot yang dialihkan ke treasury. Treasury hanya menerima
biaya skill. Contoh 10 MON / 3: 3.333333333333333334,
3.333333333333333333, 3.333333333333333333 MON.

## Yang bisa disiapkan melalui web sekarang

1. [Monad Faucet](https://faucet.monad.xyz/): tambahkan Monad Testnet ke MetaMask
   melalui **Add Testnet** jika belum ada. Masukkan alamat wallet lalu pilih
   **Get Testnet MON**. Siapkan MON testnet di deployer dan operator untuk gas,
   serta wallet pemain untuk deposit dan transaksi. Backend signer yang hanya
   menandatangani tiket tidak mengirim transaksi dan tidak membutuhkan gas.
2. [Alchemy Dashboard](https://dashboard.alchemy.com/): buat aplikasi/RPC untuk
   **Monad Testnet** (chain ID 10143). Simpan URL HTTPS lengkap ke
   `MONAD_RPC_URL` lokal dan kemudian secret backend. URL yang memuat API key
   tidak dibagikan di chat. Acuan: [quickstart resmi Monad](https://www.alchemy.com/docs/reference/monad-api-quickstart).
3. [Supabase Dashboard](https://supabase.com/dashboard): buat project, misalnya
   `dorprize`, lalu simpan password database. Buka project → **Connect** →
   **Session pooler**. Salin URL PostgreSQL, isi password yang sudah di-URL-encode,
   dan simpan sebagai `DATABASE_URL` backend dengan TLS. Gunakan URL session
   pooler port 5432 atau direct connection yang dapat dijangkau host; backend
   membutuhkan koneksi tetap untuk advisory lock. API key browser dan URL
   project bukan pengganti connection string. Acuan: [panduan koneksi resmi](https://supabase.com/docs/guides/database/connecting-to-postgres).
4. [Railway Dashboard](https://railway.com/dashboard): siapkan project dan service
   backend dari repo `alifrizqullahmaruf/DorPrize`. Pilih branch
   `codex/native-backend`, atau `main` setelah perubahan native direview dan
   digabungkan. Jalankan **satu replica**. Root service tetap root repo karena
   backend memakai workspace `shared` dan `sc`. Install `npm ci` termasuk dev
   dependencies karena start memakai `tsx`; start command:
   `npm run start -w @dorprize/backend`. Batasi watch paths ke backend/shared/sc
   dan manifest root bila perlu. Aktifkan deploy native setelah kontrak sudah
   deployed dan seluruh environment terisi; `/ready` menjadi health check.
   Acuan: [panduan monorepo Railway](https://docs.railway.com/deployments/monorepo).

## Setelah akun dan konfigurasi siap

1. Isi role publik di `sc/.env.native.example` yang disalin ke konfigurasi lokal.
   Owner sudah ditetapkan di template; deployer/operator/signer/treasury harus
   sesuai wallet yang benar-benar dapat menandatangani. Gunakan deployment
   Foundry dengan encrypted keystore dan signer lokal, sesuai `sc/NATIVE_MON.md`.
2. Deploy **NativeGameVault baru**, verifikasi kontrak, dan jalankan recorder
   receipt. Alamat deployment web Vercel maupun alamat wallet bukan alamat
   kontrak. [MonadVision](https://testnet.monadvision.com/) dipakai untuk melihat
   transaksi dan kontrak setelah deployment.
3. Isi environment backend dari `.env.native.example`: `SERVER_MODE=native`,
   `CHAIN_ID=10143`, `MONAD_RPC_URL`, `NATIVE_GAME_VAULT_ADDRESS`, kedua signing
   secret, `DATABASE_URL`, `CORS_ORIGINS` dan `AUTH_ORIGIN` domain frontend.
   Buat domain HTTPS Railway, deploy, cek `/ready`, lalu smoke test dua wallet.
4. Handoff ke teman UI: alamat kontrak, chain 10143, ABI native, RPC publik,
   explorer dan URL HTTPS backend. Frontend Vercel yang sudah ada dapat dipakai;
   integrasi MetaMask, MON 18 desimal dan endpoint native masih harus diterapkan.

Private key, seed phrase, password database dan RPC API key hanya disimpan lokal
atau di secret hosting, tidak dikirim lewat chat atau masuk Git.
