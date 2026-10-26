# Acumalaka Tracker

Acumalaka Tracker adalah expense tracker dengan frontend HTML/CSS/JavaScript dan backend Python Flask. Saat dijalankan lokal aplikasi memakai SQLite; jika `DATABASE_URL` tersedia, aplikasi memakai PostgreSQL.

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

Database lokal dibuat otomatis di `instance/rapi.sqlite3`. Pada PostgreSQL, tabel dibuat otomatis saat aplikasi mulai. Jangan membuka `index.html` langsung dari file; jalankan server agar frontend dapat berkomunikasi dengan backend.

## Akun dan privasi data

Pengguna dapat mendaftar tanpa email menggunakan username unik dan password (minimal 8 karakter). Password disimpan sebagai hash, dan transaksi serta anggaran dikaitkan dengan akun yang sedang masuk. Setiap akun hanya dapat mengakses datanya sendiri. Gunakan **Keluar** saat selesai menggunakan akun di perangkat bersama.

Saat aplikasi versi akun pertama kali dijalankan pada database lama, transaksi dan anggaran lama yang belum memiliki pemilik akan dihapus. Data tersebut tidak dapat dipetakan dengan aman ke akun tertentu.

Untuk deployment Vercel, tambahkan `DATABASE_URL` berisi connection string **Supabase Transaction pooler** dan `RAPI_SECRET_KEY` sebagai environment variables di pengaturan project Vercel. Jangan menyimpan nilai tersebut di kode atau Git. Gunakan URI pooler port `6543`; jangan gunakan Supabase publishable key sebagai URL database.

Buat nilai acak rahasia untuk `RAPI_SECRET_KEY` dengan PowerShell:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
$env:RAPI_SECRET_KEY = "tempel-nilai-acak-di-sini"
```

Setelah mengubah kode atau environment variables Vercel, deploy ulang. Gunakan HTTPS; cookie sesi otomatis ditandai secure di Vercel.

## Riwayat bulanan

Transaksi hanya dapat dicatat pada bulan berjalan. Ketika bulan berganti, transaksi bulan sebelumnya otomatis muncul di menu **Riwayat**. Anggaran bulan baru mengikuti anggaran bulan terakhir sampai pengguna mengubahnya. Pilih arsip bulan untuk melihat total, rincian kategori, dan transaksi, lalu gunakan **Cetak riwayat** untuk mencetak atau menyimpan sebagai PDF dari dialog cetak browser.

## Menjalankan tes

```powershell
python -m unittest discover -s tests
```
