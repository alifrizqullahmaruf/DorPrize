# Key dan deployment DOR PRIZE: langkah untuk Windows

Panduan 24 Oktober 2026. Ini instruksi untuk dijalankan pengguna, bukan laporan
bahwa key/deployment sudah tersedia. Target: Monad Testnet, chain ID 10143.

**Status terbaru:** setup sudah selesai, operator dipakai sebagai deployer
sesuai izin pengguna, dan kontrak terverifikasi serta uji dua wallet live lulus.
Render meminta kartu; backend sementara memakai Cloudflare Tunnel gratis.
Lihat [handoff terbaru](../docs/NATIVE_TESTNET_HANDOFF_ID.md) sebelum mengulangi
langkah deployment atau memasukkan secret lagi. Panduan di bawah tetap menjadi
referensi setup; tidak perlu mengekspor ulang key yang sudah terkonfigurasi.

## Kebutuhan inti dan pilihan signer

Jaringan membutuhkan akun yang bisa menandatangani transaksi dan memiliki MON
testnet untuk gas. Keystore adalah pilihan penyimpanan signer lokal, bukan
prasyarat protokol Monad. Panduan langkah 3-5 di bawah memakai pilihan awal:
owner juga menjadi deployer melalui keystore.

Pada kontrak proyek ini, deployer boleh berbeda dari owner: DeployNative menerima
DEPLOYER_ADDRESS untuk pengirim dan VAULT_OWNER/TREASURY sebagai argumen terpisah.
Alternatif testnet yang praktis adalah operator yang key-nya sudah tersedia
mengirim transaksi deployment, sementara owner dan treasury tetap wallet lama.
Ini membutuhkan pembaruan DEPLOYER_ADDRESS, pengecekan saldo/nonce serta simulasi
ulang untuk pengirim yang sebenarnya. Jangan memakai operator secara manual
ketika backend sudah aktif mengelola nonce. Alternatif tersebut belum dipilih
atau dijalankan; panduan di bawah tidak otomatis mengubah role.

NATIVE_GAME_VAULT_ADDRESS dan DEPLOYMENT_TX_HASH merupakan hasil deployment nyata,
bukan credential tambahan yang perlu dicari/dibuat sebelumnya. Isikan sesudah
receipt sukses/finalized dan verifikasi bytecode serta role. Untuk game live
lengkap, frontend juga masih perlu migrasi deposit USDC dan login legacy ke
payable MON, ABI native serta challenge/session token backend native.

## 1. Arti key dan pembagian akun

Private key adalah kunci rahasia satu akun wallet. Alamat wallet boleh dibagikan;
private key memberikan kemampuan menandatangani sebagai akun tersebut.
Private key berbeda dari password MetaMask dan Secret Recovery Phrase 12/24 kata.
Key yang sama dapat mengontrol akun EVM pada beberapa jaringan; gunakan akun
khusus pengembangan yang tidak menyimpan aset berharga.

| Peran                     | Alamat                                       | Tempat key                                                       |
| ------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| Owner, deployer, treasury | `0x50463168EBC5ae0Ed86efcA496b9A7A4495F7109` | Keystore terenkripsi lokal untuk deploy; tidak dikirim ke Render |
| Operator                  | `0x5EaD190F2786362c556B9BF4798326d6e11b88F2` | `OPERATOR_PRIVATE_KEY` di backend lokal/Render                   |
| Backend signer            | `0xF262fd0A43B499389b5d6ef6153e2A710685349b` | `BACKEND_SIGNER_PRIVATE_KEY` di backend lokal/Render             |

Operator mengirim transaksi room/start/settlement sehingga memerlukan MON untuk
gas. Backend signer menandatangani tiket masuk tanpa transaksi sehingga tugas
itu sendiri tidak memakai gas. Deployer memerlukan MON untuk deployment.

## 2. Ambil dua private key backend dari MetaMask

Lakukan sendiri tanpa screen sharing atau screenshot yang memperlihatkan key.

1. Buka MetaMask dan pilih pemilih akun di bagian atas.
2. Cari akun operator, cocokkan seluruh alamat dengan tabel.
3. Pilih tiga titik di sebelah akun → Account details → Private key.
4. Masukkan password MetaMask dan ikuti Hold to reveal Private Key.
5. Salin key langsung ke baris OPERATOR_PRIVATE_KEY pada backend/.env.
6. Tutup tampilan key. Ulangi untuk akun backend signer dan baris
   BACKEND_SIGNER_PRIVATE_KEY.

Di mobile: pemilih akun → tiga titik akun → Private keys → password → pilih
key jaringan EVM/Ethereum yang sesuai akun Monad.

Nilai yang diterima backend adalah 0x diikuti 64 karakter hex. Jika hasil salin
tidak memiliki 0x, tambahkan satu awalan 0x. Jika sudah ada, jangan gandakan.
Jangan memasukkan alamat publik, password MetaMask, atau recovery phrase ke
kedua variabel tersebut. Pertahankan konfigurasi RPC/database yang sudah ada.
File .env sudah diabaikan Git, tetapi isinya tetap plaintext di komputer.
Jangan mengirim key melalui chat, screenshot, commit, atau variabel NEXT_PUBLIC_*.

Rujukan resmi:
https://support.metamask.io/hc/en-us/articles/360015289632

## 3. Buat keystore deployer di folder proyek

Keystore adalah file berisi private key terenkripsi dengan password tersendiri.
Password keystore boleh berbeda dari password MetaMask dan harus disimpan privat.
Foundry v1.8.6 sudah ada di workspace; tidak perlu instalasi ulang.

Buka PowerShell lokal milik pengguna, jalankan:

```powershell
Set-Location 'C:\Users\Huda Muhammad Nur\Music\MONAD\DorPrize-current\sc'
$env:PATH = 'C:\Users\Huda Muhammad Nur\Music\MONAD\tmp\foundry-v1.8.6;' + $env:PATH
New-Item -ItemType Directory -Force '.env.keystores' | Out-Null
cast wallet import dorprize-deployer --interactive --keystore-dir .env.keystores
```

Pada prompt private key, masukkan key akun owner/deployer dari tabel, yang
diambil dengan langkah MetaMask yang sama. Pada prompt password, buat password
keystore dan ikuti konfirmasi yang diminta. Input rahasia disembunyikan.
Jangan menaruh key atau password dalam argumen perintah.

File hasil: sc/.env.keystores/dorprize-deployer. Path ini telah diperiksa cocok
dengan aturan ignore Git proyek. File tersebut tetap lokal; jangan unggah ke
Render. Cocokkan alamatnya lewat perintah baca berikut:

```powershell
cast wallet address --keystore .env.keystores/dorprize-deployer
```

Masukkan password keystore saat diminta. Alamat keluaran harus sama persis
dengan alamat deployer pada tabel. Jangan lanjut jika akun berbeda.

## 4. Periksa konfigurasi publik dan simulasi kontrak

sc/.env telah disiapkan sebelumnya. Pastikan role publiknya:

```dotenv
CHAIN_ID=10143
DEPLOYER_ADDRESS=0x50463168EBC5ae0Ed86efcA496b9A7A4495F7109
VAULT_OWNER=0x50463168EBC5ae0Ed86efcA496b9A7A4495F7109
TREASURY=0x50463168EBC5ae0Ed86efcA496b9A7A4495F7109
OPERATOR=0x5EaD190F2786362c556B9BF4798326d6e11b88F2
BACKEND_SIGNER=0xF262fd0A43B499389b5d6ef6153e2A710685349b
```

Jangan mengganti MONAD_RPC_URL yang sudah terisi. Dari folder sc, simulasi:

```powershell
forge script script/DeployNative.s.sol --network monad --rpc-url monad_native_testnet --keystore .env.keystores/dorprize-deployer --gas-estimate-multiplier 110
```

Belum memakai --broadcast, sehingga belum mengirim transaksi. Pastikan chain
10143, role benar, dan saldo MON testnet deployer cukup untuk estimasi saat ini.
Alamat simulasi tidak boleh dipakai sebagai bukti deployment.

## 5. Deploy kontrak dan catat hasil nyata

Sesudah hasil simulasi diperiksa, perintah berikut mengirim transaksi dan
menggunakan MON testnet milik deployer:

```powershell
npm run deploy:native:monad -- --keystore .env.keystores/dorprize-deployer --gas-estimate-multiplier 110
```

Masukkan password keystore pada prompt. Setelah receipt sukses dan finalized,
catat alamat NativeGameVault dan hash transaksi deployment. Periksa di
https://testnet.monadvision.com/. Masukkan alamat kontrak ke
NATIVE_GAME_VAULT_ADDRESS di sc/.env dan backend/.env; masukkan hash transaksi
ke DEPLOYMENT_TX_HASH di sc/.env.

Dari folder sc, catat deployment dengan memuat .env secara eksplisit untuk
script Node, lalu ekspor ABI dan verifikasi:

```powershell
node --env-file=.env scripts/record-native-deployment.mjs
npm run abi
npm run verify:monad
```

Recorder memeriksa receipt, finality, bytecode, schema tiket, serta role kontrak.
Jika belum finalized, tunggu dan ulangi recorder; jangan deploy ulang hanya
karena recorder belum melihat finality. Verification source harus berhasil
sebelum menganggap kontrak terverifikasi.

## 6. Isi lima environment tambahan di Render

Form yang disiapkan masih draft, belum membuat service. Jika hilang, gunakan
render.yaml sebagai acuan: Free, Singapore, branch codex/native-backend, root
repo, build npm ci --include=dev, start npm run start -w @dorprize/backend,
health check /ready, auto-deploy Off.

Tambahkan melalui Environment Variables pada form/service:

| Key                        | Value                                           |
| -------------------------- | ----------------------------------------------- |
| MONAD_RPC_URL              | URL Alchemy dari konfigurasi lokal              |
| NATIVE_GAME_VAULT_ADDRESS  | Alamat kontrak dari receipt deployment nyata    |
| DATABASE_URL               | Session-pooler Supabase dengan password dan TLS |
| OPERATOR_PRIVATE_KEY       | Key akun operator                               |
| BACKEND_SIGNER_PRIVATE_KEY | Key akun backend signer                         |

DATABASE_URL Render harus memakai sslmode=verify-full dan
sslrootcert=certs/supabase-prod-ca-2021.crt. Gunakan path relatif Linux ini,
bukan path absolut Windows yang ada pada konfigurasi lokal. Sertifikat publik
sudah ada di repo. Jangan mengubah password atau host database yang tervalidasi.
Key owner/deployer, password keystore, dan recovery phrase tidak diperlukan
Render. Memasukkan key server ke Render memberi proses backend kemampuan
menandatangani sebagai dua akun server tersebut.

Rujukan resmi: https://render.com/docs/configure-environment-variables

## 7. Jalankan backend dan periksa readiness

Sesudah lima environment lengkap, pilih Deploy web service. Periksa build dan
runtime logs tanpa membagikan secret. Service harus hidup dan endpoint /ready
harus merespons HTTP 200 sebelum URL dianggap siap untuk integrasi frontend.
Berikan URL backend HTTPS, alamat kontrak, chain ID, ABI dan explorer ke tim UI;
key server tidak masuk frontend.

Pertahankan satu instance dan auto-deploy Off. Untuk pembaruan berikutnya,
hentikan instance lama dengan terkontrol sebelum instance baru mengambil
advisory lock database; jangan mengandalkan rolling deploy bertumpuk. Render
Free dapat tidur saat idle. Hosting sehat belum membuktikan UI native sudah
diintegrasikan atau alur dua pemain live sudah lulus.
