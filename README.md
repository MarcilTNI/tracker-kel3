# Acumalaka Tracker

Acumalaka Tracker adalah expense tracker dengan frontend HTML/CSS/JavaScript dan backend Python Flask. Data anggaran dan transaksi disimpan secara lokal di SQLite.

## Menjalankan aplikasi

1. Pastikan Python 3.10 atau lebih baru sudah terpasang.
2. Buka terminal di folder project, lalu jalankan:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   python app.py
   ```

3. Buka <http://127.0.0.1:5000> di browser.

Database dibuat otomatis di `instance/rapi.sqlite3`. Jangan membuka `index.html` langsung dari file; jalankan server agar frontend dapat berkomunikasi dengan backend.

## Akun dan privasi data

Pengguna dapat mendaftar tanpa email menggunakan username unik dan password (minimal 8 karakter). Password disimpan sebagai hash, dan transaksi serta anggaran dikaitkan dengan akun yang sedang masuk. Setiap akun hanya dapat mengakses datanya sendiri. Gunakan **Keluar** saat selesai menggunakan akun di perangkat bersama.

Saat aplikasi versi akun pertama kali dijalankan pada database lama, transaksi dan anggaran lama yang belum memiliki pemilik akan dihapus. Data tersebut tidak dapat dipetakan dengan aman ke akun tertentu.

Untuk lingkungan yang dipakai bersama atau dipublikasikan, atur `RAPI_SECRET_KEY` ke nilai acak rahasia yang tetap sama setiap aplikasi dijalankan. Di PowerShell, buat nilai acak dengan:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
$env:RAPI_SECRET_KEY = "tempel-nilai-acak-di-sini"
```

Gunakan HTTPS dan set `RAPI_COOKIE_SECURE=1` saat cookie sesi hanya boleh dikirim lewat HTTPS. Pengaturan bawaan yang lebih longgar ditujukan untuk pengembangan lokal.

## Riwayat bulanan

Transaksi hanya dapat dicatat pada bulan berjalan. Ketika bulan berganti, transaksi bulan sebelumnya otomatis muncul di menu **Riwayat**. Anggaran bulan baru mengikuti anggaran bulan terakhir sampai pengguna mengubahnya. Pilih arsip bulan untuk melihat total, rincian kategori, dan transaksi, lalu gunakan **Cetak riwayat** untuk mencetak atau menyimpan sebagai PDF dari dialog cetak browser.

## Menjalankan tes

```powershell
python -m unittest discover -s tests
```
