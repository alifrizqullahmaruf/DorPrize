# 🎮 Rulebook & Game Flow: Monad Blitz #2

Dokumen ini berisi penjelasan lengkap mengenai aturan umum, alur permainan, mekanisme skill, serta sistem harga dan *cooldown* skill untuk game **Monad Blitz #2**.

## 📌 1. Aturan Umum (General Rules)

* **Kapasitas Pemain:** Minimum **2 pemain**, Maksimum **10 pemain** per *room*.
* **Akses Room:**
  * **Public** (Terbuka untuk siapa saja).
  * **Private** (Masuk menggunakan scan **QR Code**).
* **Taruhan Bid:** Minimum **\$1**.
* **Perhitungan Hadiah (Prize Pool):**
  
  $$
  \text{Total Hadiah } (X) = \text{Bid} \times \text{Jumlah Pemain}
  $$

* **Ukuran Peta (Board Size):** Minimum **2×2**, Maksimum **8×8**.
* **Waktu Per Ronde (Timing):**
  * **Round Time:** $15\text{ detik}$ (Waktu berpikir & pilih langkah/skill).
  * **Animasi:** $5\text{ detik}$ (Eksekusi visual aksi).
  * **Tampilan Hasil:** $3\text{ detik}$ (Pembaruan status pemain).
* **Urutan Eksekusi:** Skill **Pertahanan (Skill Check)** dieksekusi **lebih dahulu** daripada Serangan (**Shoot**).
* **Kondisi Kemenangan:** Pemenang adalah **pemain yang bertahan hidup paling akhir**.
  * *Catatan Logis:* Jika pemenang lebih dari 1 orang dalam waktu bersamaan, maka hasilnya dianggap **Gagal / Tidak Ada Pemenang (**$X$**)**.

---

## 🔄 2. Alur Permainan (Game Flow)

```
[1. Connect Wallet] 
         │
         ▼
[2. Main Menu] ────► Pilih Buat / Cari Room
         │
         ▼
[3. Pilih Room]
         │
         ▼
[4. Player Ready]
         │
         ▼
[5. Bid Transaksi] ──► Minimum $1
         │
         ▼
[6. Konfirmasi Transaksi] ──► Status berubah jadi Ready
         │
         ▼
[7. Prepare Game] ──► Hitung mundur 10 detik
         │
         ▼
[8. Loop Game Round]
    ├─ 15 detik : Input Aksi / Skill (Maksimal 1 skill/ronde)
    ├─ 5 detik  : Eksekusi Animasi
    └─ 3 detik  : Pembaruan Hasil & Status Pemain
         │
         ├─────────────────────────┐
         ▼                         ▼
   [Pemain Kalah]            [Pemain Menang]
         │                         │
         ▼                         ▼
   Pop-up Quit               Pop-up Menang ──► Claim Hadiah
```

---

## 🛡️ 3. Skill & Perlengkapan (Skills & Equipment)

Setiap pemain dapat membeli dan menggunakan **1 Skill per Ronde** menggunakan USDC. 

> **Catatan Cooldown:** Durasi *cooldown* dihitung **termasuk ronde saat skill digunakan**.

### 🔰 Skill Pertahanan (Defense)

| Skill | Fungsi / Mekanisme | Cooldown | Biaya (% dari Bid) |
| :--- | :--- | :---: | :---: |
| **Helm Perang** | Berfungsi sebagai pelindung/nyawa tambahan. **Tetap aktif/digunakan secara berkelanjutan** sampai terkena tembakan atau serangan dari lawan. | $4\text{ Ronde}$ | **40%** |
| **Tameng** | Menahan dan melindungi dari serangan arah **depan saja**. | $3\text{ Ronde}$ | **25%** |

### ⚔️ Skill Menyerang (Attack - Jarak Jauh)

| Skill | Fungsi / Mekanisme | Cooldown | Biaya (% dari Bid) |
| :--- | :--- | :---: | :---: |
| **Bomb / Landmine** | Aktif jika pemain/lawan berada di **petak yang sama**. Area ledakannya adalah $1 \times 1$. | $2\text{ Ronde}$ | **15%** |
| **Crossbow** | Menembak target dari jarak jauh dengan **3 arah tembakan sekaligus** (berbeda dengan pistol biasa yang hanya 1 arah). | $3\text{ Ronde}$ | **25%** |

---

## 📊 4. Pembelian & Biaya Skill (Skill Pricing Rate)

Pembelian skill di dalam game menggunakan **USDC** dengan persentase harga yang dihitung berdasarkan **Total Bid**:

| Jenis Skill | Kategori | Harga Skill (% dari Bid) | Cooldown | Efek Khusus |
| :--- | :--- | :---: | :---: | :--- |
| **Bomb / Landmine** | Serangan | **15%** | $2\text{ Ronde}$ | Area ledakan $1 \times 1$ pada petak yang sama |
| **Crossbow** | Serangan | **25%** | $3\text{ Ronde}$ | Tembakan ke 3 arah sekaligus |
| **Tameng** | Pertahanan | **25%** | $3\text{ Ronde}$ | Blokir serangan dari arah depan |
| **Helm Perang** | Pertahanan | **40%** | $4\text{ Ronde}$ | Bertahan terus sampai terkena serangan |
| **TOTAL BID BASE** | - | **100%** | - | Acuan dasar kalkulasi harga skill |

*Dokumen ini diperbarui sesuai dengan spesifikasi biaya dan mekanisme skill terbaru Monad Blitz #2.*