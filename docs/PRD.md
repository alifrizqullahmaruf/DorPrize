# PRD DOR PRIZE

Oct 19, 2026 · @GAOGAO

## Ringkasan produk

DOR PRIZE adalah game tembak "buta" berbasis giliran di papan grid untuk 2–10 pemain, di mana pemain terakhir yang bertahan mengambil seluruh pot taruhan USDC. Game ini dibangun di Monad testnet untuk Monad Blitz #2.

Konsepnya menggabungkan dua referensi: inti tebak-posisi dan tembakan sekali-mati dari game Roblox Blind Shot, serta arsitektur taruhan backend-authoritative dengan settlement EIP-712 dari proyek PassChick. Nama DOR PRIZE adalah plesetan "doorprize" dan bunyi tembakan "dor".

Tujuan MVP:

- Satu room bisa dimainkan penuh dari connect wallet sampai hadiah masuk saldo, tanpa error.
- Settlement hasil game tercatat dan terverifikasi onchain.
- Posisi pemain tidak pernah bocor ke client lain selama game berjalan.
- Satu game di papan 8×8 selesai dalam sekitar 2–3 menit.

## Ruang lingkup MVP

MVP hanya fokus pada game inti; semua fitur meta dari mockup main menu ditunda sampai setelah hackathon.

| Masuk MVP | Ditunda |
| --- | --- |
| Gameplay inti di papan grid 3D voxel isometrik | Toko dan kustomisasi berbayar |
| Room publik dan room privat via scan QR | Halaman Peringkat (leaderboard) |
| Skill: Ranjau, Shotgun, Tameng, Helm Emas | Turnamen |
| Lava menyusut setiap ronde | Battle pass, Hadiah Gratis, Grup |
| Wallet, Vault, faucet USDC testnet | Mata uang selain USDC |
| Settlement onchain dan refund | Varian tekstur pistol |
| Trofi (total kill) dan mahkota (total menang) di profil | Peluncuran ke mainnet |
| Pilih skin bebas sebelum main |  |

## Aturan umum dan alur permainan

Setiap room berisi 2–10 pemain dengan bid yang sama, dan pot dibayarkan penuh ke pemenang tanpa potongan platform.

| Aturan | Nilai |
| --- | --- |
| Pemain per room | 2–10 |
| Akses room | Publik, atau privat via scan QR |
| Bid | Minimal 1 USDC, sama untuk semua pemain dalam room |
| Pot (hadiah) | Bid × jumlah pemain |
| Ukuran papan | 2×2 sampai 8×8, jumlah petak minimal 2× jumlah pemain |
| Hitung mundur awal | 10 detik |
| Satu ronde | 15 detik input, 5 detik animasi, 3 detik hasil |
| Batas ronde | 20 ronde |

Alur pemain:

1. Connect wallet dan login dengan SIWE.
2. Deposit USDC ke Vault (di testnet, klaim dulu dari faucet).
3. Tekan MAINKAN di main menu.
4. Buat room, cari room publik, atau scan QR untuk room privat.
5. Pilih skin karakter.
6. Join room: transaksi `joinRoom` mengunci bid dari saldo Vault.
7. Status berubah jadi Ready; game mulai saat minimal 2 pemain siap.
8. Hitung mundur 10 detik, lalu loop ronde sampai ada hasil.
9. Kalah: pop-up keluar. Menang: pop-up kemenangan dan klaim hadiah.
10. Settlement onchain memindahkan hadiah ke saldo Vault; pemain bisa menariknya kapan saja.

## Mekanik ronde

Setiap ronde, semua pemain memasukkan aksi secara rahasia dan bersamaan, lalu server menyelesaikan semuanya sekaligus.

Input per pemain dalam 15 detik:

- Gerak: diam, atau pindah 1 petak ke salah satu dari 8 arah.
- Arah tembak: salah satu dari 8 arah. Arah ini sekaligus menjadi arah hadap, yang dipakai Tameng.
- Skill: opsional, maksimal 1 per ronde.
- Tidak ada input sampai waktu habis: pemain dianggap diam dan tidak menembak.

Aturan tembakan pistol:

- Ditembakkan dari petak tujuan, bukan petak asal, karena tembakan diselesaikan setelah gerakan.
- Lurus sampai tepi papan dan mengenai petak terisi pertama di jalurnya; semua pemain di petak itu kena.
- Juga mengenai pemain lain yang berada di petak yang sama dengan penembak, dari arah mana pun.
- Satu tembakan kena sudah cukup untuk eliminasi, kecuali ditahan Helm atau Tameng.

Laser bidik hanya terlihat oleh pemain itu sendiri selama fase input. Warnanya merah dengan inti putih, memancar dari petak tujuan, dan berubah jadi 3 garis saat Shotgun dipilih. Saat animasi, laser diganti jejak peluru kuning-putih yang terlihat semua pemain.

Urutan resolusi satu ronde:

1. Aktifkan skill pertahanan (Helm Emas, Tameng).
2. Pasang ranjau di petak asal.
3. Semua pemain bergerak bersamaan.
4. Ranjau meledak untuk pemain lain yang berakhir di petaknya.
5. Hitung semua tembakan dari posisi baru.
6. Terapkan damage sekaligus; pemain yang mati tetap sempat menembak.
7. Cincin lava yang retak tenggelam.
8. Cek kondisi menang.

Yang terungkap saat animasi: jejak tembakan, siapa yang mati, ledakan ranjau, helm yang pecah, dan tameng yang memblokir. Posisi pemain yang masih hidup tetap rahasia.

## Skill dan ekonomi

Empat skill dibeli per ronde dengan harga persentase dari bid, dan seluruh uang skill masuk ke treasury sistem, bukan ke pot.

| Skill | Kategori | Biaya (% bid) | Cooldown | Efek | Visual |
| --- | --- | --- | --- | --- | --- |
| Ranjau | Serangan | 15% | 2 ronde | Meledak jika lawan berhenti di petaknya; hanya terlihat pemasang | Ranjau hijau bertombol merah, berkedip di layar pemasang |
| Shotgun | Serangan | 25% | 2 ronde | 3 arah sekaligus: arah hadap dan ±45°; menggantikan pistol di ronde itu | Shotgun 2 tangan, 3 garis laser |
| Tameng | Pertahanan | 25% | 2 ronde | Blokir tembakan dari arah hadap; aktif 1 ronde | Perisai kayu di lengan kiri |
| Helm Emas | Pertahanan | 40% | 3 ronde | Menyerap 1 serangan apa pun, bertahan sampai kena; maksimal 1 aktif | Helm emas menggantikan helm bawaan skin |

Cooldown dihitung termasuk ronde saat skill dipakai. Cooldown di atas sudah diturunkan satu tingkat dari rulebook awal (Helm 4, Shotgun dan Tameng 3), karena lava menyusut membuat satu game hanya sekitar 4–6 ronde.

Aturan uang:

- Bid dikunci dari saldo Vault saat `joinRoom`.
- Pot dibayarkan ke pemenang, atau dibagi rata jika seri.
- Pembelian skill dicatat backend tanpa transaksi, lalu ditagih sekaligus dari saldo tersedia saat settlement.
- Backend hanya mengizinkan beli skill jika saldo tersedia cukup.
- Selama pemain punya room aktif, `withdraw` di Vault diblokir.

Contoh: room 4 pemain dengan bid 1 USDC menghasilkan pot 4 USDC. A membeli Helm Emas (0,40) dan Shotgun (0,25), B membeli Tameng (0,25), lalu A menang. A menerima 4 USDC dan membayar 0,65 ke treasury; B membayar 0,25; treasury menerima total 0,90 USDC.

## Arena lava menyusut

Papan berupa grid penuh petak batu di atas lava, dan setiap ronde cincin terluarnya tenggelam sampai tersisa area akhir 2×2 (papan genap) atau 3×3 (papan ganjil).

Siklus per ronde:

1. Di awal ronde, cincin terluar retak dan berkedip sebagai peringatan.
2. Pemain punya satu fase input untuk pindah; petak retak masih boleh diinjak dan dilewati.
3. Di akhir ronde, setelah semua tembakan, cincin itu tenggelam jadi lava.

| Ronde | Petak yang retak | Papan 8×8 setelah ronde |
| --- | --- | --- |
| 1 | Cincin terluar | 6×6 |
| 2 | Cincin kedua | 4×4 |
| 3 | Cincin ketiga | 2×2 |
| 4 dan seterusnya | Tidak ada | 2×2 |

Aturan tambahan:

- Posisi awal tidak pernah ditempatkan di cincin terluar.
- Pemain di petak yang tenggelam langsung mati; tidak dihitung sebagai kill siapa pun.
- Ranjau di petak yang tenggelam hancur tanpa meledak.
- Papan 2×2 dan 3×3 tidak pernah menyusut.

## Kondisi menang dan statistik

Pemain terakhir yang hidup menang seluruh pot; jika tidak ada pemenang tunggal, pot dibagi rata.

| Situasi | Hasil |
| --- | --- |
| Tersisa 1 pemain hidup | Pemain itu menang seluruh pot |
| Semua yang tersisa mati di ronde yang sama | Pot dibagi rata di antara pemain yang mati di ronde itu |
| Batas 20 ronde tercapai | Pot dibagi rata di antara pemain yang masih hidup |

Statistik profil:

- Trofi = total kill. Saling bunuh di ronde yang sama memberi 1 kill ke masing-masing. Kill dari ranjau dihitung untuk pemasangnya. Satu Shotgun yang mengenai beberapa pemain memberi 1 kill per korban. Kematian karena lava tidak dihitung.
- Mahkota = total menang. Pemain yang ikut berbagi pot karena seri juga mendapat 1 mahkota.
- Kill dan kemenangan dihitung backend dari log ronde dan disimpan di Supabase.

## UI/UX dan aset visual

Gaya visualnya voxel 3D di dunia lava, ditampilkan dengan kamera ortografis isometrik 45° dan palet yang diambil dari logo.

Logo DOR PRIZE terdiri dari "D" dan "R" putih-batu dengan peluru emas sebagai huruf O, dan "PRIZE" emas di bawahnya. Animasinya hanya kilau emas berkala. Favicon memakai ikon peluru emas diagonal di kotak hitam (`app/icon.svg`).

| Token | Warna | Dipakai untuk |
| --- | --- | --- |
| emas-utama | #F5B82E | MAINKAN, saldo USDC, hadiah, Helm Emas |
| emas-gelap | #C9851A | Bayangan tombol, state ditekan |
| oranye-tua | #9A5A12 | Outline dan sisi bayangan |
| putih-batu | #E8E8E8 | Teks utama, ikon |
| abu-batu | #8A8A8A | Teks sekunder, nonaktif |
| hitam | #111111 | Latar panel, overlay |
| merah-bahaya | #D93A2B | Eliminasi, peringatan |

Emas hanya dipakai untuk hal yang terkait uang dan aksi utama.

Main menu MVP: profil di kiri atas (avatar, nama, trofi, mahkota), saldo USDC tersedia dengan tombol Deposit/Tarik/Faucet dan chip alamat wallet di kanan atas, logo dan karakter di tengah, tombol MAINKAN di kanan bawah. Saat ada room aktif, tampilkan juga saldo yang terkunci.

Karakter: satu model 6 balok dengan tekstur skin 64×64 (`NearestFilter`). Ada 18 skin bertema perang; tiap skin memakai salah satu dari 6 helm bawaan (Basic, Desert, Urban, Winter, Jungle, Tactical). Skill tampil sebagai mesh yang ditempel ke tubuh. Senjata dasar adalah pistol Default.

| Aset | Status |
| --- | --- |
| Logo dan favicon | Ada |
| Mockup main menu | Ada, perlu disederhanakan ke MVP |
| 18 skin karakter | Ada, wajah harus diganti (lihat Risiko) |
| Pistol, Shotgun, Tameng, Ranjau, 6 helm | Ada |
| Wajah soldier original | Belum |
| Tekstur Helm Emas | Belum |
| Tekstur petak batu dan lava original | Belum |
| Efek jejak peluru, tameng blokir, helm pecah | Belum |

## Arsitektur teknis

Backend memegang semua informasi rahasia dan menentukan hasil, sedangkan blockchain hanya mengurus uang: mengunci bid, membayar pot, dan menagih biaya skill.

&#91;embedded content: arsitektur DOR PRIZE · 3 lapisan + database\]

Pemain berinteraksi langsung dengan chain hanya untuk deposit, join room, dan tarik saldo; semua aksi game lewat Socket.io ke backend.

Smart contract (Foundry, UUPS, mengikuti pola PassChick):

| Fungsi | Pemanggil | Kegunaan |
| --- | --- | --- |
| `joinRoom(roomId, bid, joinTicket)` | Pemain | Mengunci bid dari Vault; `joinTicket` ditandatangani backend untuk validasi room, kapasitas, dan akses QR |
| `leaveRoom(roomId)` | Pemain | Keluar sebelum game mulai; bid dikembalikan |
| `settleRoom(roomId, winners[], skillFees[], sig)` | Backend relayer atau frontend | Verifikasi EIP-712, bayar pot rata ke `winners[]`, tagih `skillFees[]` ke treasury; sekali per room |
| `refundRoom(roomId)` | Siapa pun | Jika room belum di-settle setelah batas waktu, semua bid dikembalikan |

`GameUSDC`, `USDCFaucet`, dan `GameVault` dipakai ulang dari PassChick, dengan tambahan: `withdraw` diblokir selama pemain punya room aktif.

State machine room di backend: LOBBY, JOINING, COUNTDOWN (10 detik), lalu ROUND\_INPUT (15 detik), ANIMATION (5 detik), RESULT (3 detik) berulang, sampai FINISHED dan SETTLED.

| Event Socket.io | Arah | Isi |
| --- | --- | --- |
| `room:join` | Client ke server | Masuk room setelah transaksi join |
| `round:submit` | Client ke server | `move`, `shootDir`, `skill` opsional |
| `room:state` | Server ke client | Daftar pemain dan status, tanpa posisi lawan |
| `round:start` | Server ke client | Nomor ronde, deadline, posisi sendiri, cooldown sendiri, cincin yang retak |
| `round:resolve` | Server ke client | Jejak tembakan, kematian, ledakan ranjau, helm pecah, tameng blokir |
| `game:end` | Server ke client | Pemenang, payout, tanda tangan settlement |

## Anti-cheat dan keamanan

Posisi pemain dan ranjau adalah informasi rahasia yang hanya boleh ada di server; satu kebocoran membuat game bisa dicurangi dengan uang sungguhan dipertaruhkan.

- Setiap pemain menerima pesan Socket.io yang dipersonalisasi. Server tidak pernah mengirim posisi pemain lain atau ranjau lawan, bahkan dalam bentuk tersembunyi atau terenkripsi.
- Posisi tidak pernah disimpan onchain selama game, karena data blockchain bersifat publik.
- Semua input divalidasi server: langkah gerak sah, skill tidak sedang cooldown, saldo cukup, dan dikirim sebelum deadline.
- Input yang sudah dikirim terkunci dan tidak bisa diubah.
- Laser dirender murni di frontend dari input pemain sendiri; server tidak mengirim apa pun soal laser.
- Log lengkap setiap ronde disimpan di Supabase untuk audit jika ada sengketa.
- `BACKEND_PRIVATE_KEY` adalah titik kegagalan tunggal: siapa pun yang memegangnya bisa menandatangani kemenangan palsu. Simpan di secret manager, jangan pernah di repo, dan siapkan skrip rotasi signer.
- Setiap `roomId` hanya bisa di-settle sekali, untuk mencegah replay tanda tangan.

## Risiko dan isu terbuka

Risiko terbesar sebelum demo adalah aset yang masih memakai IP pihak lain, bukan masalah teknis.

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Semua skin, contoh skala, dan tampilan tangan masih memakai wajah dan lengan Steve (Minecraft) | Pelanggaran hak cipta; bisa didiskualifikasi | Buat wajah soldier original dan terapkan ke semua skin; ganti nama "Steve UV" jadi "base-uv" |
| Referensi arena memakai map dan tekstur Minecraft milik orang lain | Pelanggaran hak cipta | Pakai hanya sebagai referensi suasana; buat tekstur batu dan lava sendiri |
| Nama "Stumble Pass" di mockup | Merek dagang Stumble Guys | Hapus dari MVP; ganti nama jika fitur dibuat |
| Nama skin "Arab Warrior" dan lambang salib Knight | Terkesan stereotip atau sensitif | Ganti jadi "Desert Raider" atau "Nomad"; ganti lambang dengan simbol netral |
| Model taruhan pemain-vs-pemain | Termasuk perjudian, dilarang di Indonesia jika memakai uang sungguhan | Tetap di testnet dengan USDC tiruan; kaji hukum sebelum ke mainnet |
| Backend tersentralisasi dan kontrak upgradeable | Pemain harus percaya penuh pada operator | Multisig dan timelock sebelum mainnet |
| RPC publik Monad terkena rate limit | Join atau settlement gagal saat demo | Pakai RPC khusus; siapkan cukup MON untuk relayer |

Isu terbuka:

- [ ] Konfirmasi cooldown baru (Helm 3, Shotgun 2, Tameng 2, Ranjau 2) atau kembali ke angka rulebook awal.
- [ ] Perbarui rulebook: Crossbow diganti Shotgun, hapus baris "TOTAL BID BASE".
- [ ] Konfirmasi batas waktu `refundRoom` (usulan 1 jam).
- [ ] Tentukan apakah Helm Emas 40% terlalu mahal untuk room 2 pemain.

## Rencana pengerjaan

Kerjakan dari inti yang paling rawan bug ke lapisan luar, dan tambahkan skill bertahap.

1. Engine resolusi ronde (TypeScript, fungsi murni: state + aksi semua pemain menghasilkan state baru) dengan unit test untuk saling bunuh, berbagi petak, Tameng vs Shotgun, ranjau, dan lava.
2. Kontrak `RoomManager` beserta test Foundry; pakai ulang `GameUSDC`, `USDCFaucet`, dan `GameVault`.
3. Backend: state machine room, event Socket.io personal, penandatanganan settlement.
4. Frontend: papan isometrik, karakter, laser, alur wallet dan room.
5. Skill bertahap: pistol saja, lalu Helm Emas, Tameng, Shotgun, terakhir Ranjau.
6. Aset original pengganti Steve dan tekstur Minecraft, lalu polish efek dan suara.
7. Uji coba penuh 10 pemain di testnet sebelum demo.
