-- =============================================================================
-- SISTEM INFORMASI MANAJEMEN MINIMARKET TERINTEGRASI
-- SUPABASE POSTGRESQL DDL (Data Definition Language)
-- Versi Lengkap: 21 Tabel Utama + Tabel Rincian Detail Transaksi
-- Standar: PostgreSQL 14+ / Supabase
-- Aturan Baku:
-- 1. Seluruh kuantitas stok disimpan dalam satuan eceran terkecil (Pcs).
-- 2. Tiadakan pelacakan kloter kedaluwarsa (batch_number & expired_date).
-- 3. Menggunakan gen_random_uuid() / uuid_generate_v4() untuk Primary Key UUID.
-- =============================================================================

-- Aktifkan ekstensi UUID (bawaan Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. GRUP AUTENTIKASI, PERAN (RBAC) & PENGGUNA
-- =============================================================================

-- Master Peran Pengguna
CREATE TABLE IF NOT EXISTS m_role (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama_role VARCHAR(100) NOT NULL UNIQUE,
    kode_role VARCHAR(100),
    catatan TEXT,
    system_key VARCHAR(100) UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Master Menu Navigasi
CREATE TABLE IF NOT EXISTS m_menu (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent UUID,
    name VARCHAR(100) NOT NULL,
    "desc" TEXT,
    icon VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT true,
    seq VARCHAR(100) NOT NULL DEFAULT '0',
    modul VARCHAR(100),
    sub_modul VARCHAR(100),
    path VARCHAR(100),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rincian Hak Akses Peran per Menu
CREATE TABLE IF NOT EXISTS m_role_d (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    m_role_id UUID NOT NULL REFERENCES m_role(id) ON DELETE CASCADE,
    m_menu_id UUID NOT NULL REFERENCES m_menu(id) ON DELETE CASCADE,
    is_read BOOLEAN NOT NULL DEFAULT false,
    is_create BOOLEAN NOT NULL DEFAULT false,
    is_update BOOLEAN NOT NULL DEFAULT false,
    is_delete BOOLEAN NOT NULL DEFAULT false,
    is_print BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT uq_role_menu UNIQUE (m_role_id, m_menu_id)
);

-- TABEL 1 DARI 21: user_default (Pengguna Kasir, Admin, Gudang)
CREATE TABLE IF NOT EXISTS user_default (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    catatan TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    role_id UUID NOT NULL REFERENCES m_role(id) ON DELETE RESTRICT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sesi Login Pengguna
CREATE TABLE IF NOT EXISTS auth_session (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES user_default(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_session_user ON auth_session(user_id);

-- =============================================================================
-- 2. MODUL INVENTORY: MASTER BARANG, RAK, SATUAN & ROP (JEMBATAN TENGAH)
-- =============================================================================

-- TABEL 2 DARI 21: m_category_rack (Inventory 1.2: Kategori & Zona Rak / Gudang)
CREATE TABLE IF NOT EXISTS m_category_rack (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kode VARCHAR(50) NOT NULL UNIQUE,
    nama VARCHAR(100) NOT NULL,
    tipe_zona VARCHAR(20) NOT NULL CHECK (tipe_zona IN ('GUDANG', 'RAK')),
    lokasi VARCHAR(100), -- Contoh: 'BLOK-A1' atau 'RAK-SNACK-03'
    catatan TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TABEL 3 DARI 21: m_uom (Inventory 1.3: Satuan & Konversi Kardus ke Pcs)
CREATE TABLE IF NOT EXISTS m_uom (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kode_uom VARCHAR(50) NOT NULL UNIQUE,
    nama_uom VARCHAR(100) NOT NULL,
    satuan_dasar VARCHAR(50) NOT NULL DEFAULT 'Pcs',
    satuan_beli VARCHAR(50) NOT NULL, -- Contoh: 'Kardus', 'Pack', 'Bal'
    rasio_konversi INT NOT NULL DEFAULT 1 CHECK (rasio_konversi > 0), -- 1 Kardus = N Pcs
    catatan TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TABEL 4 DARI 21: m_item (Inventory 1.1: Master Produk Eceran)
CREATE TABLE IF NOT EXISTS m_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barcode VARCHAR(100) NOT NULL UNIQUE,
    nama_barang VARCHAR(150) NOT NULL,
    category_rack_id UUID REFERENCES m_category_rack(id) ON DELETE SET NULL,
    uom_id UUID REFERENCES m_uom(id) ON DELETE SET NULL,
    harga_modal NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (harga_modal >= 0),
    harga_jual NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (harga_jual >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    catatan TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_m_item_barcode ON m_item(barcode);
CREATE INDEX IF NOT EXISTS idx_m_item_category_rack ON m_item(category_rack_id);

-- TABEL 5 DARI 21: m_item_rop (Inventory 4.1: Pengaturan Titik Pemesanan Kembali / ROP)
CREATE TABLE IF NOT EXISTS m_item_rop (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL UNIQUE REFERENCES m_item(id) ON DELETE CASCADE,
    lead_time_days INT NOT NULL DEFAULT 3 CHECK (lead_time_days >= 0),
    safety_stock_pcs INT NOT NULL DEFAULT 10 CHECK (safety_stock_pcs >= 0),
    avg_daily_sales NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (avg_daily_sales >= 0),
    rop_pcs INT NOT NULL DEFAULT 0 CHECK (rop_pcs >= 0), -- Formula: (avg_daily_sales * lead_time) + safety_stock
    max_stock_pcs INT NOT NULL DEFAULT 100 CHECK (max_stock_pcs >= 0),
    is_auto_pr BOOLEAN NOT NULL DEFAULT true,
    last_calculated_at TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 3. MODUL PURCHASING: PEMASOK, PO, PENERIMAAN, RETUR, INVOICE & BAYAR
-- =============================================================================

-- TABEL 6 DARI 21: m_supplier (Purchasing 1.1: Identitas Distributor & Syarat Pembayaran TOP)
CREATE TABLE IF NOT EXISTS m_supplier (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kode_supplier VARCHAR(50) NOT NULL UNIQUE,
    nama_supplier VARCHAR(150) NOT NULL,
    kontak_sales VARCHAR(100),
    no_telp VARCHAR(50),
    no_wa VARCHAR(50),
    alamat TEXT,
    term_of_payment INT NOT NULL DEFAULT 0 CHECK (term_of_payment >= 0), -- Tempo pembayaran (hari)
    is_active BOOLEAN NOT NULL DEFAULT true,
    catatan TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TABEL 7 DARI 21: m_supplier_catalog (Purchasing 1.2: Katalog Harga Modal Supplier)
CREATE TABLE IF NOT EXISTS m_supplier_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES m_supplier(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES m_item(id) ON DELETE CASCADE,
    harga_modal NUMERIC(18, 2) NOT NULL CHECK (harga_modal >= 0), -- HPP per Pcs
    is_active BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_supplier_item UNIQUE (supplier_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_item ON m_supplier_catalog(item_id, harga_modal);

-- TABEL 8 DARI 21: t_purchase_req (Purchasing 2.1: Antrean Rekomendasi Belanja / Auto-PR)
CREATE TABLE IF NOT EXISTS t_purchase_req (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    no_pr VARCHAR(50) NOT NULL UNIQUE,
    item_id UUID NOT NULL REFERENCES m_item(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES m_supplier(id) ON DELETE SET NULL,
    qty_saran_pcs INT NOT NULL CHECK (qty_saran_pcs > 0),
    qty_saran_beli INT NOT NULL DEFAULT 1 CHECK (qty_saran_beli > 0),
    stok_saat_ini INT NOT NULL,
    rop_threshold INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PO_CREATED', 'CANCELLED')),
    triggered_by VARCHAR(50) NOT NULL DEFAULT 'AUTO_ROP',
    catatan TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pr_status ON t_purchase_req(status);

-- TABEL 9 DARI 21: t_purchase_order (Purchasing 2.2: Surat Pesanan PO)
CREATE TABLE IF NOT EXISTS t_purchase_order (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    no_po VARCHAR(50) NOT NULL UNIQUE,
    supplier_id UUID NOT NULL REFERENCES m_supplier(id) ON DELETE RESTRICT,
    pr_id UUID REFERENCES t_purchase_req(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ORDERED' CHECK (status IN ('DRAFT', 'ORDERED', 'PARTIAL_RECEIVED', 'COMPLETED', 'CANCELLED')),
    tgl_po TIMESTAMPTZ NOT NULL DEFAULT now(),
    tgl_estimasi_tiba TIMESTAMPTZ,
    total_amount NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    catatan TEXT,
    user_id UUID REFERENCES user_default(id) ON DELETE SET NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON t_purchase_order(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON t_purchase_order(status);

-- Rincian Item Surat Pesanan PO
CREATE TABLE IF NOT EXISTS t_purchase_order_d (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id UUID NOT NULL REFERENCES t_purchase_order(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES m_item(id) ON DELETE RESTRICT,
    uom_id UUID REFERENCES m_uom(id) ON DELETE SET NULL,
    qty_order_beli INT NOT NULL DEFAULT 1 CHECK (qty_order_beli > 0),
    conversion_ratio INT NOT NULL DEFAULT 1 CHECK (conversion_ratio > 0),
    qty_order_pcs INT NOT NULL CHECK (qty_order_pcs > 0),
    harga_satuan NUMERIC(18, 2) NOT NULL CHECK (harga_satuan >= 0),
    subtotal NUMERIC(18, 2) NOT NULL CHECK (subtotal >= 0),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pod_po ON t_purchase_order_d(po_id);

-- TABEL 10 DARI 21: t_goods_receipt (Purchasing 3.1: Penerimaan Fisik di Gudang)
CREATE TABLE IF NOT EXISTS t_goods_receipt (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    no_gr VARCHAR(50) NOT NULL UNIQUE,
    po_id UUID NOT NULL REFERENCES t_purchase_order(id) ON DELETE RESTRICT,
    no_surat_jalan VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'VERIFIED', 'CANCELLED')),
    tgl_gr TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id UUID REFERENCES user_default(id) ON DELETE SET NULL,
    catatan TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gr_po ON t_goods_receipt(po_id);

-- Rincian Fisik Barang Diterima (Bagus vs Ditolak)
CREATE TABLE IF NOT EXISTS t_goods_receipt_d (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gr_id UUID NOT NULL REFERENCES t_goods_receipt(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES m_item(id) ON DELETE RESTRICT,
    uom_id UUID REFERENCES m_uom(id) ON DELETE SET NULL,
    qty_diterima_beli INT NOT NULL DEFAULT 0 CHECK (qty_diterima_beli >= 0),
    qty_bagus_pcs INT NOT NULL DEFAULT 0 CHECK (qty_bagus_pcs >= 0),
    qty_ditolak_pcs INT NOT NULL DEFAULT 0 CHECK (qty_ditolak_pcs >= 0),
    harga_satuan_pcs NUMERIC(18, 2) NOT NULL CHECK (harga_satuan_pcs >= 0),
    subtotal NUMERIC(18, 2) NOT NULL CHECK (subtotal >= 0),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grd_gr ON t_goods_receipt_d(gr_id);

-- =============================================================================
-- 4. MODUL INVENTORY: LOGISTIK, MUTASI & OPERASIONAL STOK REAL-TIME
-- =============================================================================

-- TABEL 14 DARI 21: t_stock (Inventory 2.1: Posisi Saldo Stok Gudang Belakang & Rak Toko)
-- Ketetapan: Seluruh qty dalam satuan Pcs, tanpa batch expired!
CREATE TABLE IF NOT EXISTS t_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES m_item(id) ON DELETE CASCADE,
    category_rack_id UUID REFERENCES m_category_rack(id) ON DELETE SET NULL,
    location VARCHAR(20) NOT NULL CHECK (location IN ('GUDANG', 'RAK')),
    qty INT NOT NULL DEFAULT 0 CHECK (qty >= 0), -- Saldo Pcs
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_item_location UNIQUE (item_id, location)
);
CREATE INDEX IF NOT EXISTS idx_stock_item_location ON t_stock(item_id, location);

-- TABEL 15 DARI 21: t_stock_card (Inventory 2.4: Buku Mutasi Kartu Stok Kronologis)
CREATE TABLE IF NOT EXISTS t_stock_card (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES m_item(id) ON DELETE CASCADE,
    tanggal TIMESTAMPTZ NOT NULL DEFAULT now(),
    no_dokumen VARCHAR(100) NOT NULL,
    jenis_mutasi VARCHAR(30) NOT NULL CHECK (jenis_mutasi IN ('GR_MASUK', 'MUTASI_KELUAR', 'MUTASI_MASUK', 'POS_PENJUALAN', 'BARANG_RUSAK', 'RETUR_BELI', 'OPNAME_ADJUST')),
    qty_in INT NOT NULL DEFAULT 0 CHECK (qty_in >= 0),
    qty_out INT NOT NULL DEFAULT 0 CHECK (qty_out >= 0),
    saldo_akhir INT NOT NULL CHECK (saldo_akhir >= 0),
    location VARCHAR(20) NOT NULL CHECK (location IN ('GUDANG', 'RAK')),
    user_id UUID REFERENCES user_default(id) ON DELETE SET NULL,
    keterangan TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_card_item_tgl ON t_stock_card(item_id, tanggal);

-- TABEL 16 DARI 21: t_stock_mutation (Inventory 2.2: Mutasi Gudang ke Rak Pajangan)
CREATE TABLE IF NOT EXISTS t_stock_mutation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    no_mutasi VARCHAR(50) NOT NULL UNIQUE,
    from_location VARCHAR(20) NOT NULL DEFAULT 'GUDANG' CHECK (from_location = 'GUDANG'),
    to_location VARCHAR(20) NOT NULL DEFAULT 'RAK' CHECK (to_location = 'RAK'),
    status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'CANCELLED')),
    keterangan TEXT,
    user_id UUID REFERENCES user_default(id) ON DELETE SET NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS t_stock_mutation_d (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mutation_id UUID NOT NULL REFERENCES t_stock_mutation(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES m_item(id) ON DELETE RESTRICT,
    qty_pcs INT NOT NULL CHECK (qty_pcs > 0),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TABEL 17 DARI 21: t_stock_damaged (Inventory 2.3: Pencatatan Barang Rusak / Hilang)
CREATE TABLE IF NOT EXISTS t_stock_damaged (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    no_damaged VARCHAR(50) NOT NULL UNIQUE,
    item_id UUID NOT NULL REFERENCES m_item(id) ON DELETE RESTRICT,
    category_rack_id UUID REFERENCES m_category_rack(id) ON DELETE SET NULL,
    location VARCHAR(20) NOT NULL CHECK (location IN ('GUDANG', 'RAK')),
    qty_pcs INT NOT NULL CHECK (qty_pcs > 0),
    kategori VARCHAR(30) NOT NULL CHECK (kategori IN ('INTERNAL_LOSS', 'SUPPLIER_RETURN')),
    alasan VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED', 'RETURNED_TO_SUPPLIER', 'WRITTEN_OFF')),
    user_id UUID REFERENCES user_default(id) ON DELETE SET NULL,
    catatan TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_damaged_kategori ON t_stock_damaged(kategori, status);

-- TABEL 11 DARI 21: t_purchase_return (Purchasing 3.2: Retur Pembelian ke Distributor)
CREATE TABLE IF NOT EXISTS t_purchase_return (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    no_retur VARCHAR(50) NOT NULL UNIQUE,
    po_id UUID NOT NULL REFERENCES t_purchase_order(id) ON DELETE RESTRICT,
    supplier_id UUID NOT NULL REFERENCES m_supplier(id) ON DELETE RESTRICT,
    damaged_id UUID REFERENCES t_stock_damaged(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'MATCHED_INVOICE', 'CANCELLED')),
    total_potongan NUMERIC(18, 2) NOT NULL CHECK (total_potongan >= 0),
    tgl_retur TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id UUID REFERENCES user_default(id) ON DELETE SET NULL,
    catatan TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS t_purchase_return_d (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    retur_id UUID NOT NULL REFERENCES t_purchase_return(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES m_item(id) ON DELETE RESTRICT,
    qty_pcs INT NOT NULL CHECK (qty_pcs > 0),
    harga_satuan_pcs NUMERIC(18, 2) NOT NULL CHECK (harga_satuan_pcs >= 0),
    subtotal NUMERIC(18, 2) NOT NULL CHECK (subtotal >= 0),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TABEL 12 DARI 21: t_purchase_invoice (Purchasing 4.1: Verifikasi Nota 3-Way Matching)
CREATE TABLE IF NOT EXISTS t_purchase_invoice (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    no_invoice VARCHAR(50) NOT NULL UNIQUE,
    po_id UUID NOT NULL REFERENCES t_purchase_order(id) ON DELETE RESTRICT,
    gr_id UUID NOT NULL REFERENCES t_goods_receipt(id) ON DELETE RESTRICT,
    return_id UUID REFERENCES t_purchase_return(id) ON DELETE SET NULL,
    tgl_invoice TIMESTAMPTZ NOT NULL DEFAULT now(),
    tgl_jatuh_tempo TIMESTAMPTZ NOT NULL,
    gross_amount NUMERIC(18, 2) NOT NULL CHECK (gross_amount >= 0),
    return_deduction NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (return_deduction >= 0),
    net_payable NUMERIC(18, 2) NOT NULL CHECK (net_payable >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID', 'PARTIAL', 'PAID', 'OVERDUE')),
    user_id UUID REFERENCES user_default(id) ON DELETE SET NULL,
    catatan TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_jatuh_tempo ON t_purchase_invoice(tgl_jatuh_tempo, status);

-- TABEL 13 DARI 21: t_purchase_payment (Purchasing 4.2: Pembayaran Hutang Supplier)
CREATE TABLE IF NOT EXISTS t_purchase_payment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    no_payment VARCHAR(50) NOT NULL UNIQUE,
    invoice_id UUID NOT NULL REFERENCES t_purchase_invoice(id) ON DELETE RESTRICT,
    supplier_id UUID NOT NULL REFERENCES m_supplier(id) ON DELETE RESTRICT,
    tgl_bayar TIMESTAMPTZ NOT NULL DEFAULT now(),
    jumlah_bayar NUMERIC(18, 2) NOT NULL CHECK (jumlah_bayar > 0),
    metode_bayar VARCHAR(30) NOT NULL DEFAULT 'TRANSFER' CHECK (metode_bayar IN ('TRANSFER', 'GIRO', 'KAS')),
    no_referensi VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'PENDING', 'CANCELLED')),
    user_id UUID REFERENCES user_default(id) ON DELETE SET NULL,
    catatan TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_invoice ON t_purchase_payment(invoice_id);

-- TABEL 18 DARI 21: t_stock_opname (Inventory 3.1: Hitung Fisik Lapangan)
CREATE TABLE IF NOT EXISTS t_stock_opname (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    no_opname VARCHAR(50) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
    tgl_opname TIMESTAMPTZ NOT NULL DEFAULT now(),
    catatan TEXT,
    user_id UUID REFERENCES user_default(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES user_default(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS t_stock_opname_d (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opname_id UUID NOT NULL REFERENCES t_stock_opname(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES m_item(id) ON DELETE RESTRICT,
    category_rack_id UUID REFERENCES m_category_rack(id) ON DELETE SET NULL,
    location VARCHAR(20) NOT NULL CHECK (location IN ('GUDANG', 'RAK')),
    qty_sistem INT NOT NULL,
    qty_fisik INT NOT NULL CHECK (qty_fisik >= 0),
    selisih INT NOT NULL,
    catatan TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TABEL 19 DARI 21: t_stock_adjustment (Inventory 3.2: Penyesuaian Selisih Opname)
CREATE TABLE IF NOT EXISTS t_stock_adjustment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    no_adjustment VARCHAR(50) NOT NULL UNIQUE,
    opname_id UUID REFERENCES t_stock_opname(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED', 'CANCELLED')),
    tgl_adjustment TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id UUID REFERENCES user_default(id) ON DELETE SET NULL,
    catatan TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS t_stock_adjustment_d (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adjustment_id UUID NOT NULL REFERENCES t_stock_adjustment(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES m_item(id) ON DELETE RESTRICT,
    location VARCHAR(20) NOT NULL CHECK (location IN ('GUDANG', 'RAK')),
    qty_adjustment INT NOT NULL CHECK (qty_adjustment > 0),
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('IN', 'OUT')),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 5. MODUL POINT OF SALE: SHIFT KASIR & TRANSAKSI CHECKOUT
-- =============================================================================

-- TABEL 20 DARI 21: t_cashier_shift (POS 2.1 & 2.2: Shift Kasir, Modal & Rekonsiliasi)
CREATE TABLE IF NOT EXISTS t_cashier_shift (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    no_shift VARCHAR(50) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES user_default(id) ON DELETE RESTRICT,
    modal_awal NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (modal_awal >= 0),
    modal_akhir NUMERIC(18, 2),
    total_tunai NUMERIC(18, 2) NOT NULL DEFAULT 0,
    total_non_tunai NUMERIC(18, 2) NOT NULL DEFAULT 0,
    uang_fisik_laci NUMERIC(18, 2),
    selisih NUMERIC(18, 2),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    catatan TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shift_user_status ON t_cashier_shift(user_id, status);

-- TABEL 21 DARI 21: t_pos_order (POS 1.1: Mesin Kasir / Checkout)
CREATE TABLE IF NOT EXISTS t_pos_order (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    no_struk VARCHAR(50) NOT NULL UNIQUE,
    shift_id UUID NOT NULL REFERENCES t_cashier_shift(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES user_default(id) ON DELETE RESTRICT,
    total_amount NUMERIC(18, 2) NOT NULL CHECK (total_amount >= 0),
    bayar NUMERIC(18, 2) NOT NULL CHECK (bayar >= 0),
    kembalian NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (kembalian >= 0),
    metode_bayar VARCHAR(20) NOT NULL DEFAULT 'TUNAI' CHECK (metode_bayar IN ('TUNAI', 'QRIS', 'EDC', 'TRANSFER')),
    status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'VOID')),
    catatan TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_order_shift ON t_pos_order(shift_id);
CREATE INDEX IF NOT EXISTS idx_pos_order_created ON t_pos_order("createdAt");

-- Rincian Item Belanja Kasir
CREATE TABLE IF NOT EXISTS t_pos_order_d (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES t_pos_order(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES m_item(id) ON DELETE RESTRICT,
    qty_pcs INT NOT NULL CHECK (qty_pcs > 0),
    harga_satuan NUMERIC(18, 2) NOT NULL CHECK (harga_satuan >= 0),
    diskon NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (diskon >= 0),
    subtotal NUMERIC(18, 2) NOT NULL CHECK (subtotal >= 0),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_order_d_order ON t_pos_order_d(order_id);
CREATE INDEX IF NOT EXISTS idx_pos_order_d_item ON t_pos_order_d(item_id);

-- =============================================================================
-- DATA AWAL WAJIB (SEED DATA RBAC & PENGGUNA AWAL)
-- =============================================================================
INSERT INTO m_role (id, nama_role, kode_role, system_key)
VALUES 
    ('00000000-0000-0000-0000-000000000001', 'Super Admin', 'SUPER_ADMIN', 'SUPER_ADMIN'),
    ('00000000-0000-0000-0000-000000000002', 'Admin / Manajer Toko', 'ADMIN', 'ADMIN'),
    ('00000000-0000-0000-0000-000000000003', 'Staf Gudang & Logistik', 'GUDANG', 'GUDANG'),
    ('00000000-0000-0000-0000-000000000004', 'Kasir', 'KASIR', 'KASIR')
ON CONFLICT (nama_role) DO NOTHING;

-- Pengguna Admin default (password: admin123)
INSERT INTO user_default (id, name, username, password_hash, role_id)
VALUES (
    '00000000-0000-0000-0000-000000000099',
    'Administrator Utama',
    'admin',
    '$2b$10$vI8aWBnW3fID.ZQ4/zo1G.q1lRps.9cGLcZEiGPEWi9GQORtNVq6K',
    '00000000-0000-0000-0000-000000000001'
) ON CONFLICT (username) DO NOTHING;
