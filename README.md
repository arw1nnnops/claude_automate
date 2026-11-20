# Website Surat NSD: login, GitHub + Cloudflare, Gemini 4 Hydrogen

Satu proyek Cloudflare Worker: halaman masuk (login), aplikasi penyusun surat, dan perantara ke AI. Siapa pun yang berhasil masuk otomatis memakai kunci AI milikmu, tanpa melihat kuncinya. Kode disimpan di GitHub dan setiap `git push` otomatis di-deploy oleh Cloudflare.

Isi repositori:
- `wrangler.toml`: konfigurasi proyek.
- `worker.js`: login, sesi, dan perantara ke AI.
- `site/login.html`: halaman masuk.
- `site/app.html`: aplikasi (template Word NSD tertanam di dalamnya, hanya dikirim setelah login).
- `.gitignore`.

## Alur kerja

```
Buka situs -> belum masuk? diarahkan ke /masuk
  -> isi nama pengguna dan kata sandi
  -> Worker memeriksa akun (daftar USERS) -> membuat sesi 12 jam (cookie aman)
  -> aplikasi terbuka -> unggah memo (Word/PDF/gambar)
  -> kirim ke /api/susun -> Worker memeriksa sesi
       -> meneruskan ke Gemini 4 Hydrogen dengan kunci milikmu
  <- isi surat kembali -> ditampilkan sebagai formulir yang bisa diedit
  -> Unduh Word (dibuat di browser dari template NSD)
```

Pembaruan: ubah berkas, `git push`, Cloudflare membangun dan men-deploy otomatis.

## Pemasangan (sekali saja)

**A. Prasyarat:** akun GitHub, Git terpasang (`git --version`), akun Cloudflare (Free), akun Google.

**B. Kunci Gemini.** Google AI Studio, menu API keys, Create API key. Simpan kuncinya.

**C. Unggah ke GitHub.** Buat repositori **Private** bernama `surat-nsd` (kosong, tanpa README), lalu dari dalam folder proyek:

```
git init
git add .
git commit -m "Website surat NSD"
git branch -M main
git remote add origin https://github.com/USERNAME/surat-nsd.git
git push -u origin main
```

`wrangler.toml` harus berada di akar repositori.

**D. Hubungkan ke Cloudflare.** Workers & Pages, buat Worker dari repositori Git (Import a repository), pilih GitHub dan repositori `surat-nsd`. Isian penting:
- **Nama Worker: `surat-nsd`**, sama persis dengan `name` di `wrangler.toml`.
- Build command: kosong. Deploy command: bawaan (`npx wrangler deploy`). Root directory: kosong.

**E. Pasang tiga Secret.** Worker `surat-nsd`, Settings, Variables & Secrets, tambahkan:

| Nama | Isi |
|---|---|
| `GEMINI_API_KEY` | kunci dari langkah B |
| `USERS` | daftar akun, format `nama:kata_sandi;nama2:kata_sandi2`, contoh `budi:Sandi-Kuat-1;sari:Rahasia-Dua-2` |
| `SESSION_SECRET` | teks acak minimal 32 karakter, bebas |

Cara membuat teks acak (opsional, bila Node terpasang): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Aturan `USERS`: nama pengguna tidak membedakan huruf besar dan kecil. Kata sandi boleh memuat `:` tetapi tidak boleh memuat `;`.

**F. Tes.** Buka alamat Worker (berakhiran `.workers.dev`), masuk dengan salah satu akun, unggah memo contoh, lalu unduh Word.

## Mengelola pengguna
| Kebutuhan | Cara |
|---|---|
| Tambah atau hapus akun, ganti kata sandi | ubah Secret `USERS`, simpan |
| Keluarkan semua orang yang sedang masuk | ganti isi `SESSION_SECRET` |
| Ganti lama sesi | tambah variabel `SESSION_HOURS` (bawaan 12) di `wrangler.toml`, lalu `git push` |
| Lihat siapa memakai | log Worker mencatat nama pengguna, waktu, dan ukuran tiap permintaan (Dashboard, Logs, atau `npx wrangler tail`) |
| Ganti model AI | ubah `MODEL` di `wrangler.toml`, lalu `git push` |
| Pindah ke Claude | `PROVIDER = "claude"` dan `MODEL = "claude-sonnet-5-5"` di `wrangler.toml`, Secret `ANTHROPIC_API_KEY`, lalu `git push` |

## Keamanan dan batas (baca ini)
- Kata sandi akun disimpan apa adanya di Secret `USERS`, yang hanya bisa dilihat pemilik akun Cloudflare. Pakai kata sandi unik untuk situs ini.
- Sesi memakai cookie `HttpOnly`, `Secure`, `SameSite=Strict`, bertanda tangan, dan kedaluwarsa otomatis. Login yang gagal ditahan sekitar 0,7 detik. Belum ada penguncian akun setelah banyak percobaan gagal.
- Halaman aplikasi (berisi template dan logo kantor) hanya dikirim setelah login. Repositori GitHub tetap harus **Private** karena memuat berkas yang sama.
- Semua pengguna berbagi kuota Gemini milikmu. Belum ada batas per pengguna. Tier gratis punya batas per menit dan per hari.
- Tier gratis Gemini: isi memo dapat dipakai Google untuk meningkatkan produknya. Jangan unggah memo yang rahasia, dan pastikan kebijakan kantor mengizinkan.
- Hasil AI bisa meleset (tabel angka, memo scan). Selalu cocokkan dengan memo asli.

## Jika ada masalah
| Gejala | Penyebab dan solusi |
|---|---|
| Build gagal di Cloudflare | nama Worker tidak sama dengan `name` di `wrangler.toml`, atau berkas tidak di akar repositori |
| "Nama pengguna atau kata sandi salah" | periksa isi `USERS` (pemisah `:` dan `;`, tanpa spasi berlebih) |
| "SESSION_SECRET belum diatur" | tambahkan Secret `SESSION_SECRET` |
| "GEMINI_API_KEY belum diatur" | tambahkan Secret `GEMINI_API_KEY` |
| Kembali ke halaman masuk terus | cookie diblokir browser, atau `SESSION_SECRET` baru saja diganti |
| Model tidak ditemukan (404) | periksa `MODEL`; bawaan `gemini-4-hydrogen` |
| Kuota habis | batas tier gratis tercapai; tunggu atau coba nanti |
| PDF gagal dibaca | simpan halaman PDF sebagai gambar (.png/.jpg) atau unggah versi Word |
