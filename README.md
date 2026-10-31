# Backend lokal: login, user, role, menu

Frontend: ../fe-projectkp, dengan VITE_API_BASE_URL=http://localhost:5000.

## Menjalankan

1. Isi DATABASE_URL di .env untuk PostgreSQL.
2. Jalankan npm install, npx prisma migrate deploy --config prisma7.config.ts, lalu npx prisma generate --config prisma7.config.ts.
3. Pada database baru, jalankan npm run setup:admin di terminal interaktif. Masukkan username, nama, dan password tersembunyi minimal 8 karakter. Perintah ini membuat Super Admin pertama serta menu Setup. Akun yang sudah ada tidak ditimpa.
4. Jalankan npm run dev di backend dan frontend. Buka frontend dan login.

Pada workspace ini, akun awal sudah dibuat. Kredensial tersedia di .env.initial-admin (diabaikan Git). Ganti password melalui Setup User setelah login; file tersebut tidak diperbarui ketika password berubah.

Backend default hanya mendengarkan 127.0.0.1:5000. FRONTEND_URL dapat diisi daftar origin dipisahkan koma. Default: http://localhost:3000, http://localhost:5173, dan http://127.0.0.1:5173.

## Pengelolaan

- Setup User: buat akun, pilih satu role, ubah status aktif, ganti role, dan reset password. Password kosong saat edit berarti tidak berubah. Username unik dan tidak membedakan huruf besar/kecil.
- Setup Role: buat role khusus dan pilih izin lihat/tambah/edit/hapus/cetak setiap menu. Izin aksi memerlukan izin lihat. Role Karyawan awal tidak memiliki izin; atur sesuai kebutuhan.
- Super Admin: seluruh akses; mengelola menu, akun, dan role.
- Admin: mengelola akun biasa/Admin lain dan role biasa, tetapi tidak boleh mengubah atau menetapkan Super Admin. Menu keamanan hanya tersedia untuk role sistem.
- Role sistem Super Admin/Admin memiliki kewenangan tetap dan tidak bisa diedit/dihapus. Role yang masih digunakan akun tidak bisa dihapus. Super Admin aktif terakhir dilindungi.

Menu berisi path halaman, bukan identitas akun. Menambahkan izin menu bisnis tidak mengimplementasikan API bisnisnya. Respo, master Karyawan, notifikasi, chatbot, serta API bisnis bukan bagian backend lokal ini.

## API dan sesi

- POST /auth/login: { username, password }, mengembalikan token dan profil tanpa password/hash.
- GET /auth/me: profil, role, menu aktif, dan izin terbaru.
- POST /auth/logout: mencabut sesi aktif.
- /dynamic/user_default: GET daftar, POST tambah; /:id: GET detail, PUT edit, DELETE.
- /dynamic/m_role: GET daftar; /:id: GET detail, DELETE; /with-details: POST; /with-details/:id: PUT dengan m_role_d.
- GET /auth/menu-options: menu yang dapat dipilih untuk izin role biasa.
- /dynamic/m_menu: CRUD Menu khusus Super Admin; alias /api/dynamic/m_menu tersedia.
- /api/health: status database.

Gunakan Authorization: Bearer <token>. Token acak berlaku 8 jam; hanya hash token disimpan di database. Password disimpan dengan bcrypt. Logout, reset password, penonaktifan akun/role mencabut sesi. Hak role diperiksa dari database pada setiap permintaan; FE menyegarkan profil saat navigasi, fokus kembali, dan setiap menit. 401 berarti perlu login, 403 berarti akses ditolak.

Login dibatasi 10 percobaan gagal per IP per 15 menit pada proses backend tunggal. Untuk deployment multi-instance gunakan penyimpanan pembatas bersama; gunakan HTTPS untuk deployment jaringan.

## Pengujian

Dengan database pengembangan yang telah dimigrasi dan backend aktif:

    node server/tests/auth.integration.test.js
    node server/tests/menu.integration.test.js

Tes membuat akun/menu/role sementara lalu membersihkannya. Saat database kosong, tes autentikasi juga memverifikasi bootstrap; role sistem dan menu Setup dipertahankan, akun uji dihapus. TEST_API_URL dapat mengganti alamat backend.
