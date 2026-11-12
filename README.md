# be-minimarket — Backend Minimarket

Backend API minimarket berbasis Node.js (ES Module) + Express + PostgreSQL/Supabase (Prisma 7).
Mencakup autentikasi & RBAC, master data, inventory, purchasing, dan POS.

Frontend: `../fe-projectkp` (default `VITE_API_BASE_URL=http://localhost:5000`).

## Stack

- Node.js >= 20 (dikembangkan di Node 24), ES Module
- Express 4
- Prisma 7 + `@prisma/adapter-pg` (PostgreSQL/Supabase)
- Joi (validasi), bcryptjs (password), JSON Web Token, Bearer token acak 64 hex

## Menjalankan

1. Salin/isi `.env` (minimal `DATABASE_URL`, `PORT`, `FRONTEND_URL`).
2. `npm install`
3. `npx prisma migrate deploy --config prisma7.config.ts`
4. `npx prisma generate --config prisma7.config.ts`
5. Database baru: `npm run setup:admin` (interaktif) untuk membuat Super Admin + menu Setup.
6. `npm run dev` (watch) atau `npm start`.

Backend mendengarkan `0.0.0.0:5000` (dapat diubah lewat `HOST`/`PORT`).
`FRONTEND_URL` berisi daftar origin CORS dipisahkan koma.

> Prisma client digenerate ke `src/models/prisma` (lihat `prisma/schema.prisma`). Jangan hapus folder itu.
> Konfigurasi Prisma 7 ada di `prisma7.config.ts` (migration path: `prisma/migrations`).

## Struktur folder

```
prisma/
  schema.prisma                 # sumber kebenaran model & relasi
  migrations/                   # migration SQL (baseline + inventory/purchasing/pos)
src/
  app.js                        # express app (CORS, JSON, mount routes, error handler)
  modules/index.js              # mount seluruh route (legacy + /api/v1)
  config/database.js            # Prisma client + adapter pg
  core/
    crud.js                     # createCrudService / createCrudController / createCrudRouter
    middlewares/
      auth.js                   # authenticate, managerOnly, superOnly, requireRoles, validateGuidParam
      error.js                  # handler error (termasuk error Prisma P2002/P2025)
    utils/
      helpers.js                # wrap, fail, hashToken, ROLES, isManager/isSuper/hasRole, publicUser
      query.js                  # parseListQuery, buildWhere, paginationMeta, parseDateRange
      validation.js             # validate + skema Joi dasar (uuid, money, qty, text, ...)
      documentNumber.js         # nextDocumentNumber (PO/GR/GRT/INV/RTS/SHF/...)
      securityTx.js             # securityTransaction + advisory lock
  modules/
    auth/                       # login, me, logout, menu-options
    system/                     # user_default, m_role, m_menu
    inventory/
      master.routes.js          # kategori, satuan, rak, barang (+ barcode, stok per barang)
      stock.routes.js           # stok, kartu stok, mutasi, penyesuaian, opname, alert
      stock.helper.js           # addStock, removeStockFEFO, writeCard, moveStockLots, sumStock
    purchasing/                 # supplier, harga supplier, PO, GR, retur, invoice, AP, rekomendasi
    pos/                        # settings, produk kasir, shift, checkout, hold, void, retur, laporan
  scripts/bootstrap-admin.js
  tests/                        # integration test (butuh server + database termigrasi)
```

Pola layer: `routes` → `middlewares` (auth/RBAC/validasi param) → `controller` → `service` → Prisma.
Master data sederhana memakai `createCrudService` + `createCrudRouter`; modul transaksi memakai service eksplisit.

## Respons & kontrak query

Sukses:

```json
{ "status": "success", "data": {}, "pagination": {} }
```

Gagal:

```json
{ "status": "error", "message": "..." }
```

Query list standar (dipakai semua endpoint daftar):

| Param | Keterangan |
| --- | --- |
| `page` | halaman, default `1` |
| `paginate` | jumlah per halaman, default `20`, maks `1000` |
| `order_by` | field urut (dibatasi per endpoint), default `createdAt` |
| `order_type` | `ASC` / `DESC`, default `DESC` |
| `search` | pencarian teks (field tertentu per endpoint) |
| `no_pagination=true` | ambil semua baris |
| `filter_column_<field>` | filter exact, hanya field yang diizinkan endpoint |
| `from`, `to` | rentang tanggal pada endpoint transaksi/laporan |

## Autentikasi & RBAC

Gunakan header `Authorization: Bearer <token>`.

Role sistem: `SUPER_ADMIN`, `ADMIN`, `KASIR`, `GUDANG` (Pramuniaga/Gudang).
Super Admin selalu lolos semua `requireRoles`.

Endpoint legacy:

| Method | Path | Akses |
| --- | --- | --- |
| POST | `/auth/login` | publik |
| GET | `/auth/me` | login |
| POST | `/auth/logout` | login |
| GET | `/auth/menu-options` | Admin |
| GET/POST/PUT/DELETE | `/dynamic/user_default[/:id]` | Admin |
| GET/POST/PUT/DELETE | `/dynamic/m_role[/:id]`, `/with-details[/:id]` | Admin |
| GET/POST/PUT/DELETE | `/dynamic/m_menu[/:id]` dan `/api/dynamic/m_menu[/:id]` | Super Admin |
| GET | `/api/health` | publik |

### Aturan akses sensitif

- **CORS**: hanya origin pada `FRONTEND_URL` (dipisah koma) yang diizinkan; origin lain tidak mendapat header CORS. Request tanpa `Origin` (curl, server-to-server) tetap jalan.
- **Shift kasir**: checkout, tutup shift, dan laporan shift hanya untuk pemilik shift. Admin/Super Admin boleh menutup atau melihat shift kasir lain, tetapi checkout tetap harus memakai shift miliknya sendiri.
- **Barang rusak**: `KASIR` boleh `POST /api/v1/inventory/damaged` hanya untuk lokasi `RAK` dan tanpa `po_id`. Penautan PO/nota retur dan laporan stok gudang khusus `GUDANG`/`ADMIN`.
- **Finansial**: seluruh `/api/v1/purchasing` hanya untuk `GUDANG`, `ADMIN`, `SUPER_ADMIN`. Invoice, jadwal utang, dan riwayat pembelian khusus `ADMIN`/`SUPER_ADMIN`.
- **Harga modal**: endpoint inventory tidak mengirim `harga_modal` (dan harga katalog supplier) ke `KASIR`/`GUDANG`; `ADMIN`/`SUPER_ADMIN` tetap menerima data penuh.

## Inventory — `/api/v1/inventory`

Semua endpoint butuh login. Operasi tulis master & stok butuh Admin; opname butuh Gudang/Admin.

| Method | Path | Keterangan |
| --- | --- | --- |
| GET/POST/PUT/DELETE | `/categories[/:id]` | Kategori barang |
| GET/POST/PUT/DELETE | `/units[/:id]` | Satuan |
| GET/POST/PUT/DELETE | `/racks[/:id]` | Rak (WAREHOUSE/SHELF) |
| GET/POST/PUT/DELETE | `/items[/:id]` | Barang + multi-UOM + rak |
| GET | `/items/barcode/:barcode` | Lookup barang untuk kasir |
| GET | `/items/:id/stock` | Stok per lokasi (WAREHOUSE/SHELF) |
| GET | `/stocks` | Daftar stok per barang (ringkasan gudang/rak) |
| GET | `/stocks/:id` | Detail stok per lot/batch |
| GET | `/cards` | Kartu stok (mutasi in/out + saldo) |
| GET/POST | `/mutations` | Mutasi gudang → rak (atomik, FEFO) |
| GET | `/mutations/:id` | Detail mutasi |
| GET/POST | `/adjustments` | Penyesuaian stok (EXPIRED/DAMAGED/OTHER) |
| GET | `/adjustments/:id` | Detail penyesuaian |
| GET/POST | `/opnames` | Stock opname (DRAFT) |
| GET/PUT | `/opnames/:id` | Detail / ubah opname DRAFT |
| POST | `/opnames/:id/submit` | Ajukan opname |
| POST | `/opnames/:id/approve` | Setujui & sesuaikan stok (atomik) |
| POST | `/opnames/:id/reject` | Tolak opname |
| GET | `/alerts/min-stock` | Barang di bawah/sama dengan min stok |
| GET | `/alerts/expired` | Lot mendekati/sudah expired |

## Purchasing — `/api/v1/purchasing`

| Method | Path | Akses | Keterangan |
| --- | --- | --- | --- |
| GET/POST/PUT/DELETE | `/suppliers[/:id]` | baca login, tulis Admin | Supplier |
| GET | `/suppliers/:id/prices` | login | Daftar harga per supplier |
| GET/POST/PUT/DELETE | `/supplier-prices[/:id]` | baca login, tulis Admin | Harga beli supplier |
| GET | `/purchase-orders`, `/purchase-orders/:id` | login | Daftar/detail PO |
| POST/PUT | `/purchase-orders[/:id]` | Admin, Gudang | Buat/ubah PO (DRAFT) |
| POST | `/purchase-orders/:id/order` | Admin, Gudang | DRAFT → ORDERED |
| POST | `/purchase-orders/:id/cancel` | Admin, Gudang | Batalkan PO |
| GET | `/goods-receipts`, `/goods-receipts/:id` | login | Penerimaan barang |
| POST | `/goods-receipts` | Admin, Gudang | Terima barang (menambah stok WAREHOUSE) |
| GET | `/purchase-returns`, `/purchase-returns/:id` | login | Retur pembelian |
| POST | `/purchase-returns` | Admin, Gudang | Buat retur (DRAFT) |
| POST | `/purchase-returns/:id/complete` | Admin, Gudang | Proses retur (kurangi stok WAREHOUSE, FEFO) |
| POST | `/purchase-returns/:id/cancel` | Admin, Gudang | Batalkan retur DRAFT |
| GET | `/purchase-invoices`, `/purchase-invoices/:id` | login | Invoice + hasil 3-way matching |
| POST | `/purchase-invoices` | Admin | Buat invoice (`force=true` bila selisih disetujui) |
| PATCH | `/purchase-invoices/:id/status` | Admin | `UNPAID` / `PARTIAL` / `PAID` |
| GET | `/payables` | login | AP schedule + aging bucket |
| GET | `/purchase-recommendations` | login | Rekomendasi belanja (tidak membuat PO) |

**Sistem tidak membuat PO otomatis.** Rekomendasi belanja hanya usulan; PO tetap dibuat manual oleh Admin.

## POS — `/api/v1/pos`

| Method | Path | Akses | Keterangan |
| --- | --- | --- | --- |
| GET | `/settings/public` | login | Pengaturan toko yang aman ditampilkan |
| GET | `/settings` | Admin | Semua setting + nilai efektif |
| PUT | `/settings` | Admin | Upsert setting |
| GET | `/products` | Kasir, Admin | Produk + stok rak untuk kasir |
| GET | `/shifts`, `/shifts/:id` | login | Daftar/detail shift |
| POST | `/shifts/open` | Kasir, Admin | Buka shift (`modal_awal`) |
| GET | `/shifts/:id/summary` | Admin | Ringkasan + expected cash |
| GET | `/shifts/:id/report` | Admin | Laporan per shift |
| POST | `/shifts/:id/close` | Kasir (milik sendiri), Admin | Blind closing (`saldo_fisik` saja) |
| GET | `/orders`, `/orders/:id` | login | Daftar/detail transaksi |
| POST | `/orders` | Kasir, Admin | Checkout atomik (potong stok SHELF, FEFO) |
| GET | `/orders/:id/receipt` | login | Data struk + footer toko |
| POST | `/orders/:id/void` | Admin | Void transaksi (stok kembali ke SHELF) |
| GET/POST | `/holds` | login / Kasir | Daftar & simpan transaksi tertahan |
| POST | `/holds/:id/take` | Kasir, Admin | Ambil kembali hold |
| DELETE | `/holds/:id` | login | Hapus hold |
| GET | `/returns`, `/returns/:id` | login | Retur penjualan |
| POST | `/returns` | Kasir, Admin | Ajukan retur (butuh `pos.return_enabled=true`) |
| POST | `/returns/:id/approve` | Admin | Setujui retur (stok kembali ke SHELF) |
| POST | `/returns/:id/reject` | Admin | Tolak retur |
| GET | `/reports/sales` | Admin | Omzet netto, HPP, laba kotor, best seller |

### Setting penting (`m_store_setting`)

| Key | Default | Efek |
| --- | --- | --- |
| `pos.return_enabled` | `false` | Mengaktifkan retur penjualan |
| `pos.require_shift` | `true` | Checkout wajib punya shift OPEN |
| `store.name`, `store.address`, `store.phone` | — | Identitas pada struk |
| `pos.receipt_footer` | — | Footer struk |

## Aturan bisnis penting

- **Satuan dasar**: stok selalu disimpan dalam satuan terkecil (`base_unit`). Multi-UOM disimpan di `m_item_unit` (`unit_name`, `conversion`); satuan dasar dinormalisasi otomatis.
- **Lokasi stok**: `WAREHOUSE` (gudang) dan `SHELF` (rak jual). Kasir hanya memotong `SHELF`.
- **Atomik & anti-minus**: semua perubahan stok dijalankan dalam `prisma.$transaction` (`securityTransaction`). Stok tidak boleh negatif.
- **FEFO**: pengurangan stok memakai lot dengan `expired_date` terdekat.
- **Nomor dokumen** (`PO`, `GR`, `RTP`, `INV`, `SHF`, `POS`, `RTS`, `MUT`, dll.) dibuat dengan advisory lock agar unik antar-request.
- **Blind closing**: kasir hanya mengirim `saldo_fisik`; sistem menghitung `expected_cash = modal_awal + penjualan tunai − nilai retur`.
- **Laporan penjualan**: omzet netto = penjualan − retur; HPP memakai `harga_modal`; laba kotor = omzet netto − HPP netto.
- **Void** ditolak bila masih ada retur berstatus `PENDING`; retur `COMPLETED` tidak menambah stok dua kali.
- **Error Prisma** (`P2002`, `P2025`, dll.) dipetakan ke respons 4xx di `src/core/middlewares/error.js`.

## Contoh request

Login:

```bash
curl -X POST http://localhost:5000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"rahasia123"}'
```

Buat barang (multi-UOM):

```bash
curl -X POST http://localhost:5000/api/v1/inventory/items \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "barcode": "8991234567890",
    "nama_barang": "Air Mineral 600ml",
    "base_unit": "botol",
    "harga_modal": 2500,
    "harga_jual": 4000,
    "min_stock": 12,
    "max_stock": 120,
    "units": [
      { "unit_name": "botol", "conversion": 1, "is_base": true, "is_sell_unit": true },
      { "unit_name": "dus", "conversion": 24, "is_base": false, "is_sell_unit": false }
    ]
  }'
```

Buat PO lalu pesan:

```bash
curl -X POST http://localhost:5000/api/v1/purchasing/purchase-orders \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "supplier_id": "<uuid>",
    "items": [{ "item_id": "<uuid>", "qty": 48, "harga_satuan": 2200 }]
  }'

curl -X POST http://localhost:5000/api/v1/purchasing/purchase-orders/<po_id>/order \
  -H "Authorization: Bearer $TOKEN"
```

Terima barang (masuk ke WAREHOUSE):

```bash
curl -X POST http://localhost:5000/api/v1/purchasing/goods-receipts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "po_id": "<po_id>",
    "items": [{
      "item_id": "<item_id>",
      "qty_diterima": 48,
      "qty_ditolak": 0,
      "batch_number": "B-001",
      "expired_date": "2027-12-31",
      "harga_satuan": 2200
    }]
  }'
```

Mutasi gudang → rak, lalu checkout:

```bash
curl -X POST http://localhost:5000/api/v1/inventory/mutations \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"from_location":"WAREHOUSE","to_location":"SHELF","items":[{"item_id":"<uuid>","qty":24}]}'

curl -X POST http://localhost:5000/api/v1/pos/shifts/open \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"modal_awal":100000}'

curl -X POST http://localhost:5000/api/v1/pos/orders \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"items":[{"item_id":"<uuid>","qty":2}],"bayar":20000,"metode_bayar":"TUNAI"}'
```

Tutup shift (blind closing):

```bash
curl -X POST http://localhost:5000/api/v1/pos/shifts/<shift_id>/close \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"saldo_fisik":107000}'
```

## Migrasi

```bash
npx prisma migrate status --config prisma7.config.ts
npx prisma migrate deploy --config prisma7.config.ts
npx prisma validate --config prisma7.config.ts
npx prisma generate --config prisma7.config.ts
```

Cek drift (harus `diff_exit=0`):

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma \
  --exit-code --config prisma7.config.ts
```

## Pengujian

Dengan database pengembangan yang sudah dimigrasi **dan backend berjalan**:

```bash
npm test
# atau jalankan file tertentu
node src/tests/auth.integration.test.js
node src/tests/menu.integration.test.js
```

`TEST_API_URL` dapat mengganti alamat backend (default `http://localhost:5000`).
Tes membuat akun/menu/role sementara lalu membersihkannya.

## Catatan / batasan

- `t_purchase_order` tidak menyimpan total header; total dihitung dari detail.
- `t_purchase_invoice` hanya terhubung ke PO (belum ada `supplier_id`); status pembayaran masih manual.
- `t_goods_receipt.po_id` wajib — penerimaan tanpa PO belum didukung.
- Detail retur penjualan tidak menyimpan lot/batch; stok retur masuk ke `SHELF` tanpa batch/expiry.
- `t_pos_order` belum punya diskon level header; `t_pos_hold` menyimpan item sebagai `items_json`.
