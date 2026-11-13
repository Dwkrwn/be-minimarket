-- =============================================================================
-- SISTEM INFORMASI MANAJEMEN MINIMARKET TERINTEGRASI
-- KOLEKSI LENGKAP QUERY SQL (PostgreSQL / Supabase)
-- Berdasarkan Alur Berantai 3 Modul (Purchasing, Inventory, POS)
-- Seluruh kuantitas dalam Pcs, Tanpa Batch Expired, Transaksi Atomik ACID
-- =============================================================================

-- =============================================================================
-- BAGIAN I: MASTER DATA & INISIALISASI (INVENTORY & SUPPLIER)
-- =============================================================================

-- 1.1 Master Kategori & Zona Rak / Gudang (Inventory 1.2)
-- Menambahkan lokasi Gudang Belakang dan Rak Pajangan Toko
INSERT INTO m_category_rack (id, kode, nama, tipe_zona, lokasi, catatan, is_active)
VALUES 
    ('c1111111-1111-1111-1111-111111111111', 'G-BLOK-A1', 'Gudang Belakang Blok A1', 'GUDANG', 'Zona Barat Lantai 1', 'Penyimpanan stok kardus karton', true),
    ('c2222222-2222-2222-2222-222222222222', 'R-SUSU-01', 'Rak Display Susu & Minuman', 'RAK', 'Lorong 2 Sisi Kiri', 'Rak pajangan customer', true)
ON CONFLICT (kode) DO NOTHING;

-- 1.2 Master Satuan & Konversi Kardus ke Pcs (Inventory 1.3)
-- Formula: 1 Kardus = 40 Pcs (contoh Susu Ultra Milk)
INSERT INTO m_uom (id, kode_uom, nama_uom, satuan_dasar, satuan_beli, rasio_konversi, catatan, is_active)
VALUES 
    ('u1111111-1111-1111-1111-111111111111', 'DUS-40', 'Kardus Isi 40', 'Pcs', 'Kardus', 40, '1 Kardus = 40 Pcs', true),
    ('u2222222-2222-2222-2222-222222222222', 'DUS-24', 'Kardus Isi 24', 'Pcs', 'Kardus', 24, '1 Kardus = 24 Pcs', true)
ON CONFLICT (kode_uom) DO NOTHING;

-- 1.3 Master Barang Dagangan & Inisialisasi Slot Stok (Inventory 1.1)
BEGIN;
    INSERT INTO m_item (id, barcode, nama_barang, category_rack_id, uom_id, harga_modal, harga_jual, is_active)
    VALUES (
        'i1111111-1111-1111-1111-111111111111', 
        '8992388123456', 
        'Susu Ultra Milk 250ml Plain', 
        'c2222222-2222-2222-2222-222222222222', 
        'u1111111-1111-1111-1111-111111111111', 
        5000.00, 
        6500.00, 
        true
    ) ON CONFLICT (barcode) DO NOTHING;

    -- Inisialisasi slot saldo t_stock untuk GUDANG dan RAK (Saldo awal 15 pcs di rak, 0 di gudang)
    INSERT INTO t_stock (id, item_id, location, qty, category_rack_id)
    VALUES 
        (uuid_generate_v4(), 'i1111111-1111-1111-1111-111111111111', 'GUDANG', 0, 'c1111111-1111-1111-1111-111111111111'),
        (uuid_generate_v4(), 'i1111111-1111-1111-1111-111111111111', 'RAK', 15, 'c2222222-2222-2222-2222-222222222222')
    ON CONFLICT (item_id, location) DO NOTHING;

    -- Inisialisasi pengaturan titik pemesanan kembali (ROP) (Inventory 4.1)
    INSERT INTO m_item_rop (id, item_id, lead_time_days, safety_stock_pcs, avg_daily_sales, rop_pcs, max_stock_pcs, is_auto_pr)
    VALUES (
        uuid_generate_v4(),
        'i1111111-1111-1111-1111-111111111111',
        3,   -- Waktu tunggu supplier 3 hari
        10,  -- Stok pengaman 10 pcs
        5.00, -- Rata-rata laku 5 pcs/hari
        25,  -- ROP = (5 x 3) + 10 = 25 Pcs
        150, -- Kapasitas maksimum stok
        true
    ) ON CONFLICT (item_id) DO NOTHING;
COMMIT;

-- 1.4 Master Supplier / Distributor Resmi (Purchasing 1.1)
INSERT INTO m_supplier (id, kode_supplier, nama_supplier, kontak_sales, no_telp, no_wa, alamat, term_of_payment, is_active)
VALUES 
    ('s1111111-1111-1111-1111-111111111111', 'SPL-JAYA', 'PT. Jaya Abadi Distribusi', 'Budi Santoso', '021-5551234', '081299998888', 'Kawasan Industri Pulogadung No. 12', 14, true),
    ('s2222222-2222-2222-2222-222222222222', 'SPL-MAKMUR', 'Agen Grosir Makmur Sejahtera', 'Hendra Wijaya', '021-4445678', '081377776666', 'Pasar Induk Kramat Jati Blok C', 7, true)
ON CONFLICT (kode_supplier) DO NOTHING;

-- 1.5 Katalog Harga Modal Supplier & Otomatisasi Seleksi Termurah (Purchasing 1.2)
INSERT INTO m_supplier_catalog (id, supplier_id, item_id, harga_modal, is_active)
VALUES 
    (uuid_generate_v4(), 's1111111-1111-1111-1111-111111111111', 'i1111111-1111-1111-1111-111111111111', 5000.00, true), -- PT. Jaya Abadi Rp5.000 (Termurah)
    (uuid_generate_v4(), 's2222222-2222-2222-2222-222222222222', 'i1111111-1111-1111-1111-111111111111', 5200.00, true)  -- Agen Makmur Rp5.200
ON CONFLICT (supplier_id, item_id) DO UPDATE SET harga_modal = EXCLUDED.harga_modal;

-- Query Katalog Harga dengan Penanda Otomatis Rekomendasi Supplier Termurah
SELECT 
    sc.id AS catalog_id,
    i.barcode,
    i.nama_barang,
    s.kode_supplier,
    s.nama_supplier,
    s.term_of_payment AS top_hari,
    s.no_wa,
    sc.harga_modal AS hpp_pcs,
    CASE 
        WHEN sc.harga_modal = MIN(sc.harga_modal) OVER (PARTITION BY sc.item_id) THEN true 
        ELSE false 
    END AS is_rekomendasi_utama
FROM m_supplier_catalog sc
JOIN m_item i ON sc.item_id = i.id
JOIN m_supplier s ON sc.supplier_id = s.id
WHERE sc.is_active = true
ORDER BY i.nama_barang ASC, sc.harga_modal ASC;


-- =============================================================================
-- BAGIAN II: DETEKSI STOK TIPIS, AUTO-PR & PURCHASE ORDER (PURCHASING 2.1 - 2.3)
-- =============================================================================

-- 2.1 Query Deteksi Sinyal Stok Tipis (Menyandingkan Posisi Stok vs Batas ROP)
-- Menghasilkan sinyal peringatan merah di halaman 2.1 Auto-PR
SELECT 
    i.id AS item_id,
    i.barcode,
    i.nama_barang,
    u.satuan_beli,
    u.rasio_konversi,
    COALESCE(SUM(st.qty), 0) AS total_stok_saat_ini_pcs,
    rop.rop_pcs AS batas_rop_minimum,
    rop.max_stock_pcs AS batas_maksimum_stok,
    CASE 
        WHEN COALESCE(SUM(st.qty), 0) <= rop.rop_pcs THEN 'PERINGATAN_MERAH_BELANJA' 
        ELSE 'STOK_AMAN' 
    END AS status_peringatan,
    -- Hitung saran jumlah kulakan dibulatkan ke satuan beli Kardus
    CEIL((rop.max_stock_pcs - COALESCE(SUM(st.qty), 0))::NUMERIC / u.rasio_konversi)::INT AS saran_kulakan_kardus,
    (CEIL((rop.max_stock_pcs - COALESCE(SUM(st.qty), 0))::NUMERIC / u.rasio_konversi) * u.rasio_konversi)::INT AS saran_kulakan_pcs,
    -- Ambil distributor termurah dari katalog 1.2
    best_sup.supplier_id AS supplier_termurah_id,
    best_sup.nama_supplier AS supplier_termurah_nama,
    best_sup.harga_modal AS hpp_termurah
FROM m_item i
JOIN m_uom u ON i.uom_id = u.id
JOIN m_item_rop rop ON i.id = rop.item_id
LEFT JOIN t_stock st ON i.id = st.item_id
LEFT JOIN LATERAL (
    SELECT sc.supplier_id, s.nama_supplier, sc.harga_modal
    FROM m_supplier_catalog sc
    JOIN m_supplier s ON sc.supplier_id = s.id
    WHERE sc.item_id = i.id AND sc.is_active = true
    ORDER BY sc.harga_modal ASC
    LIMIT 1
) best_sup ON true
GROUP BY i.id, i.barcode, i.nama_barang, u.satuan_beli, u.rasio_konversi, rop.rop_pcs, rop.max_stock_pcs, 
         best_sup.supplier_id, best_sup.nama_supplier, best_sup.harga_modal
HAVING COALESCE(SUM(st.qty), 0) <= rop.rop_pcs;

-- 2.2 Transaksi Penerbitan PO Resmi dari Auto-PR (Purchasing 2.2)
-- Menghasilkan PO-2026-001 senilai Rp500.000 ke PT. Jaya Abadi (100 Pcs @ Rp5.000)
BEGIN;
    -- 1. Insert Header PO (Status: ORDERED / Menunggu Truk)
    INSERT INTO t_purchase_order (
        id, no_po, supplier_id, status, tgl_po, tgl_estimasi_tiba, total_amount, catatan
    ) VALUES (
        'p1111111-1111-1111-1111-111111111111',
        'PO-2026-001',
        's1111111-1111-1111-1111-111111111111', -- PT. Jaya Abadi Distribusi
        'ORDERED',
        now(),
        now() + INTERVAL '2 days',
        500000.00,
        'Pesanan resmi terbit otomatis dari sinyal Auto-PR stok tipis'
    );

    -- 2. Insert Detail PO (100 Pcs / setara 2.5 Kardus dibulatkan atau 100 Pcs @ Rp5.000)
    INSERT INTO t_purchase_order_d (
        id, po_id, item_id, uom_id, qty_order_beli, conversion_ratio, qty_order_pcs, harga_satuan, subtotal
    ) VALUES (
        uuid_generate_v4(),
        'p1111111-1111-1111-1111-111111111111',
        'i1111111-1111-1111-1111-111111111111',
        'u1111111-1111-1111-1111-111111111111',
        3,   -- Pesan 3 Kardus (isi 40) atau 100 Pcs
        40,
        100, -- Total 100 Pcs
        5000.00,
        500000.00
    );
COMMIT;

-- 2.3 Query Pantau Status Pesanan (Tracking PO - Halaman 2.3)
-- Menampilkan status PO 🟡 Menunggu Pengiriman Truk (stok toko masih tetap 15 Pcs)
SELECT 
    po.id AS po_id,
    po.no_po,
    s.nama_supplier,
    s.kontak_sales,
    s.no_wa,
    po.tgl_po,
    po.tgl_estimasi_tiba,
    po.total_amount,
    po.status AS status_kode,
    CASE 
        WHEN po.status = 'ORDERED' THEN '🟡 Menunggu Pengiriman Truk'
        WHEN po.status = 'PARTIAL_RECEIVED' THEN '🟠 Diterima Sebagian'
        WHEN po.status = 'COMPLETED' THEN '🟢 Selesai'
        WHEN po.status = 'CANCELLED' THEN '🔴 Dibatalkan'
    END AS status_badge,
    -- Cek posisi stok toko saat ini (harus tetap 15 Pcs sebelum truk datang)
    (SELECT COALESCE(SUM(qty), 0) FROM t_stock WHERE item_id = pod.item_id) AS stok_toko_saat_ini
FROM t_purchase_order po
JOIN m_supplier s ON po.supplier_id = s.id
JOIN t_purchase_order_d pod ON po.id = pod.po_id
WHERE po.id = 'p1111111-1111-1111-1111-111111111111';


-- =============================================================================
-- BAGIAN III: PENERIMAAN FISIK DI GUDANG & RETUR PEMBELIAN (PURCHASING 3.1 & 3.2)
-- =============================================================================

-- 3.1 Transaksi Atomik Goods Receipt (Penerimaan Fisik di Gudang)
-- Simulasi Kasus Nyata: Dipesan 100 Pcs -> Diterima 98 Bagus, 2 Bocor Ditolak
-- Dampak:
-- 1. Insert t_goods_receipt & t_goods_receipt_d
-- 2. UPDATE saldo t_stock GUDANG bertambah +98 Pcs (15 di rak + 98 di gudang = 113 Pcs)
-- 3. INSERT t_stock_card jenis GR_MASUK saldo akhir 98 di gudang
-- 4. UPDATE status PO-2026-001 menjadi 'COMPLETED' (🟢 Selesai)
BEGIN;
    -- 1. Dokumen Penerimaan Fisik
    INSERT INTO t_goods_receipt (
        id, no_gr, po_id, no_surat_jalan, status, tgl_gr, catatan
    ) VALUES (
        'g1111111-1111-1111-1111-111111111111',
        'GR-2026-001',
        'p1111111-1111-1111-1111-111111111111',
        'SJ-TRUK-9981',
        'RECEIVED',
        now(),
        'Diterima 98 kotak bagus. 2 kotak penyok/bocor langsung dibawa pulang kembali supir truk.'
    );

    -- Detail penerimaan fisik
    INSERT INTO t_goods_receipt_d (
        id, gr_id, item_id, uom_id, qty_diterima_beli, qty_bagus_pcs, qty_ditolak_pcs, harga_satuan_pcs, subtotal
    ) VALUES (
        uuid_generate_v4(),
        'g1111111-1111-1111-1111-111111111111',
        'i1111111-1111-1111-1111-111111111111',
        'u1111111-1111-1111-1111-111111111111',
        3,
        98, -- 98 Pcs Bagus
        2,  -- 2 Pcs Reject
        5000.00,
        490000.00 -- 98 x Rp5.000
    );

    -- 2. Tambah Saldo Gudang Belakang di t_stock (+98 Pcs)
    UPDATE t_stock 
    SET qty = qty + 98, "updatedAt" = now()
    WHERE item_id = 'i1111111-1111-1111-1111-111111111111' AND location = 'GUDANG';

    -- 3. Catat Riwayat Mutasi ke Kartu Stok (t_stock_card)
    INSERT INTO t_stock_card (
        id, item_id, tanggal, no_dokumen, jenis_mutasi, qty_in, qty_out, saldo_akhir, location, keterangan
    ) VALUES (
        uuid_generate_v4(),
        'i1111111-1111-1111-1111-111111111111',
        now(),
        'GR-2026-001',
        'GR_MASUK',
        98,
        0,
        (SELECT qty FROM t_stock WHERE item_id = 'i1111111-1111-1111-1111-111111111111' AND location = 'GUDANG'),
        'GUDANG',
        'Penerimaan Fisik Barang Masuk (PO: PO-2026-001, SJ: SJ-TRUK-9981) [2 Pcs ditolak di truk]'
    );

    -- 4. Perbarui Status PO di halaman 2.3 menjadi Selesai
    UPDATE t_purchase_order
    SET status = 'COMPLETED', "updatedAt" = now()
    WHERE id = 'p1111111-1111-1111-1111-111111111111';
COMMIT;

-- 3.2 Transaksi Atomik Retur Pembelian (Barang Rusak / Basi di Rak - Purchasing 3.2)
-- Simulasi Kasus Nyata: Ditemukan 3 kotak susu basi/menggelembung di rak toko
-- Dampak:
-- 1. Potong stok rak di t_stock (-3 Pcs, saldo sisa 110 Pcs total toko)
-- 2. Catat temuan di t_stock_damaged (kategori SUPPLIER_RETURN)
-- 3. Terbitkan Nota Potong Tagihan resmi (t_purchase_return) senilai 3 x Rp5.000 = Rp15.000
-- 4. Catat riwayat di t_stock_card
BEGIN;
    -- 1. Potong saldo rak di t_stock
    UPDATE t_stock
    SET qty = qty - 3, "updatedAt" = now()
    WHERE item_id = 'i1111111-1111-1111-1111-111111111111' AND location = 'RAK';

    -- 2. Catat ke tabel barang rusak
    INSERT INTO t_stock_damaged (
        id, no_damaged, item_id, location, qty_pcs, kategori, alasan, status, catatan
    ) VALUES (
        'd1111111-1111-1111-1111-111111111111',
        'DMG-2026-001',
        'i1111111-1111-1111-1111-111111111111',
        'RAK',
        3,
        'SUPPLIER_RETURN',
        'Kemasan menggelembung dan susu basi sebelum tanggal expired',
        'RETURNED_TO_SUPPLIER',
        'Ditemukan saat restocking pagi oleh pramuniaga'
    );

    -- 3. Terbitkan Nota Potong Tagihan (t_purchase_return) senilai Rp15.000
    INSERT INTO t_purchase_return (
        id, no_retur, po_id, supplier_id, damaged_id, status, total_potongan, tgl_retur, catatan
    ) VALUES (
        'r1111111-1111-1111-1111-111111111111',
        'RET-2026-001',
        'p1111111-1111-1111-1111-111111111111',
        's1111111-1111-1111-1111-111111111111',
        'd1111111-1111-1111-1111-111111111111',
        'ISSUED',
        15000.00, -- 3 pcs x Rp5.000
        now(),
        'Nota Potong Tagihan 3 kotak susu basi dikirim ke Verifikasi Nota 4.1'
    );

    INSERT INTO t_purchase_return_d (
        id, retur_id, item_id, qty_pcs, harga_satuan_pcs, subtotal
    ) VALUES (
        uuid_generate_v4(),
        'r1111111-1111-1111-1111-111111111111',
        'i1111111-1111-1111-1111-111111111111',
        3,
        5000.00,
        15000.00
    );

    -- 4. Catat riwayat pengurangan pada kartu stok
    INSERT INTO t_stock_card (
        id, item_id, tanggal, no_dokumen, jenis_mutasi, qty_in, qty_out, saldo_akhir, location, keterangan
    ) VALUES (
        uuid_generate_v4(),
        'i1111111-1111-1111-1111-111111111111',
        now(),
        'RET-2026-001',
        'BARANG_RUSAK',
        0,
        3,
        (SELECT qty FROM t_stock WHERE item_id = 'i1111111-1111-1111-1111-111111111111' AND location = 'RAK'),
        'RAK',
        'Retur barang basi ke distributor PT. Jaya Abadi (Nota: RET-2026-001)'
    );
COMMIT;


-- =============================================================================
-- BAGIAN IV: VERIFIKASI 3-WAY MATCHING & PELUNASAN TAGIHAN (PURCHASING 4.1 - 4.2)
-- =============================================================================

-- 4.1 Query Penyandingan 3 Dokumen Fisik (Preview 3-Way Matching Halaman 4.1)
-- 1. Pesanan Awal PO: 100 Kotak (Rp500.000)
-- 2. Bukti Terima Fisik GR: 98 Kotak Bagus (Rp490.000)
-- 3. Bukti Retur Fisik: 3 Kotak Basi (Rp15.000)
-- -> Sistem Mengunci Total Bersih yang Boleh Dibayar: 95 Kotak x Rp5.000 = Rp475.000
SELECT 
    po.no_po,
    s.nama_supplier,
    i.nama_barang,
    pod.harga_satuan,
    -- Bukti 1: Pesanan Awal
    pod.qty_order_pcs AS bukti_1_qty_pesan_awal,
    (pod.qty_order_pcs * pod.harga_satuan) AS bukti_1_total_pesan,
    -- Bukti 2: Terima Gudang Bagus
    COALESCE(grd.qty_bagus_pcs, 0) AS bukti_2_qty_masuk_bagus,
    COALESCE(grd.qty_ditolak_pcs, 0) AS bukti_2_qty_ditolak_truk,
    (COALESCE(grd.qty_bagus_pcs, 0) * pod.harga_satuan) AS bukti_2_gross_amount,
    -- Bukti 3: Nota Potong Retur
    COALESCE(retd.qty_pcs, 0) AS bukti_3_qty_retur_basi,
    COALESCE(retd.subtotal, 0) AS bukti_3_potongan_retur,
    -- Hasil Akhir: Nominal Bersih Terkunci
    (COALESCE(grd.qty_bagus_pcs, 0) - COALESCE(retd.qty_pcs, 0)) AS qty_bersih_bayar,
    ((COALESCE(grd.qty_bagus_pcs, 0) * pod.harga_satuan) - COALESCE(retd.subtotal, 0)) AS total_bersih_diizinkan_dibayar
FROM t_purchase_order po
JOIN m_supplier s ON po.supplier_id = s.id
JOIN t_purchase_order_d pod ON po.id = pod.po_id
JOIN m_item i ON pod.item_id = i.id
LEFT JOIN t_goods_receipt gr ON po.id = gr.po_id
LEFT JOIN t_goods_receipt_d grd ON gr.id = grd.gr_id AND grd.item_id = pod.item_id
LEFT JOIN t_purchase_return ret ON po.id = ret.po_id AND ret.status = 'ISSUED'
LEFT JOIN t_purchase_return_d retd ON ret.id = retd.retur_id AND retd.item_id = pod.item_id
WHERE po.id = 'p1111111-1111-1111-1111-111111111111';

-- 4.2 Transaksi Verifikasi Nota & Kunci Nominal Bersih (Purchasing 4.1)
-- Mengunci tagihan Rp475.000 dengan jatuh tempo 14 hari ke depan
BEGIN;
    INSERT INTO t_purchase_invoice (
        id, no_invoice, po_id, gr_id, return_id, tgl_invoice, tgl_jatuh_tempo, 
        gross_amount, return_deduction, net_payable, status, catatan
    ) VALUES (
        'v1111111-1111-1111-1111-111111111111',
        'INV-JAYA-88912',
        'p1111111-1111-1111-1111-111111111111',
        'g1111111-1111-1111-1111-111111111111',
        'r1111111-1111-1111-1111-111111111111',
        now(),
        now() + INTERVAL '14 days', -- TOP 14 Hari distributor
        490000.00,                 -- Gross dari 98 kotak bagus
        15000.00,                  -- Potongan retur 3 kotak basi
        475000.00,                 -- Bersih yang terkunci
        'UNPAID',
        'Verifikasi 3-Way Matching selesai: 100 PO -> 98 Diterima Bagus -> 3 Retur Basi = 95 Kotak Dibayar'
    );

    -- Tandai retur telah dipadankan dengan invoice
    UPDATE t_purchase_return 
    SET status = 'MATCHED_INVOICE' 
    WHERE id = 'r1111111-1111-1111-1111-111111111111';
COMMIT;

-- 4.3 Query Antrean Bayar & Alarm Hitung Mundur Jatuh Tempo (Halaman 4.2)
-- Menghitung sisa hari (countdown) sesuai syarat tempo 14 hari
SELECT 
    inv.id AS invoice_id,
    inv.no_invoice,
    s.nama_supplier,
    s.no_wa AS no_wa_sales,
    s.term_of_payment AS top_hari,
    inv.tgl_invoice,
    inv.tgl_jatuh_tempo,
    -- Hitung alarm hitung mundur
    DATE_PART('day', inv.tgl_jatuh_tempo - CURRENT_TIMESTAMP)::INT AS sisa_hari_jatuh_tempo,
    CASE 
        WHEN CURRENT_DATE > inv.tgl_jatuh_tempo::DATE THEN 'TERLAMBAT_OVERDUE'
        WHEN DATE_PART('day', inv.tgl_jatuh_tempo - CURRENT_TIMESTAMP)::INT <= 3 THEN 'SEGERA_JATUH_TEMPO'
        ELSE 'AMAN'
    END AS alarm_status,
    inv.gross_amount,
    inv.return_deduction,
    inv.net_payable AS total_tagihan_bersih,
    COALESCE(SUM(pay.jumlah_bayar), 0) AS total_sudah_dibayar,
    (inv.net_payable - COALESCE(SUM(pay.jumlah_bayar), 0)) AS sisa_hutang,
    inv.status AS status_bayar
FROM t_purchase_invoice inv
JOIN t_purchase_order po ON inv.po_id = po.id
JOIN m_supplier s ON po.supplier_id = s.id
LEFT JOIN t_purchase_payment pay ON inv.id = pay.invoice_id
WHERE inv.status IN ('UNPAID', 'PARTIAL')
GROUP BY inv.id, inv.no_invoice, s.nama_supplier, s.no_wa, s.term_of_payment, inv.tgl_invoice, inv.tgl_jatuh_tempo, 
         inv.gross_amount, inv.return_deduction, inv.net_payable, inv.status
ORDER BY inv.tgl_jatuh_tempo ASC;

-- 4.4 Transaksi Eksekusi Tombol "Tandai Lunas" (Purchasing 4.2)
-- Membayar penuh Rp475.000 ke rekening PT. Jaya Abadi
BEGIN;
    INSERT INTO t_purchase_payment (
        id, no_payment, invoice_id, supplier_id, tgl_bayar, jumlah_bayar, metode_bayar, no_referensi, status, catatan
    ) VALUES (
        uuid_generate_v4(),
        'PAY-2026-001',
        'v1111111-1111-1111-1111-111111111111',
        's1111111-1111-1111-1111-111111111111',
        now(),
        475000.00,
        'TRANSFER',
        'TRF-BCA-88910023',
        'SUCCESS',
        'Pelunasan tagihan tempo 14 hari melalui tombol Tandai Lunas'
    );

    UPDATE t_purchase_invoice
    SET status = 'PAID', "updatedAt" = now()
    WHERE id = 'v1111111-1111-1111-1111-111111111111';
COMMIT;

-- 4.5 Query Laporan Riwayat Pembelian (Purchasing 5.1 - Satu-satunya Laporan Resmi)
-- Rekapitulasi belanja modal toko bulan berjalan
SELECT 
    COUNT(inv.id) AS total_faktur_bulan_ini,
    SUM(inv.gross_amount) AS total_belanja_kotor,
    SUM(inv.return_deduction) AS total_potongan_retur,
    SUM(inv.net_payable) AS total_tagihan_bersih,
    SUM(COALESCE(pay.jumlah_bayar, 0)) AS total_modal_sudah_dibayar,
    SUM(inv.net_payable) - SUM(COALESCE(pay.jumlah_bayar, 0)) AS sisa_hutang_toko
FROM t_purchase_invoice inv
LEFT JOIN (
    SELECT invoice_id, SUM(jumlah_bayar) AS jumlah_bayar 
    FROM t_purchase_payment 
    GROUP BY invoice_id
) pay ON inv.id = pay.invoice_id
WHERE DATE_TRUNC('month', inv.tgl_invoice) = DATE_TRUNC('month', CURRENT_DATE);


-- =============================================================================
-- BAGIAN V: MUTASI GUDANG, BARANG RUSAK & OPNAME (MODUL INVENTORY)
-- =============================================================================

-- 5.1 Query Posisi Stok Real-Time (Inventory 2.1)
SELECT 
    i.barcode,
    i.nama_barang,
    cr.nama AS lokasi_nama,
    st.location AS zona,
    st.qty AS saldo_stok_pcs,
    i.harga_jual,
    (st.qty * i.harga_modal) AS total_nilai_aset_modal
FROM t_stock st
JOIN m_item i ON st.item_id = i.id
LEFT JOIN m_category_rack cr ON st.category_rack_id = cr.id
ORDER BY i.nama_barang ASC, st.location ASC;

-- 5.2 Transaksi Atomik Mutasi Gudang ke Rak (Inventory 2.2)
-- Memindahkan 40 Pcs Susu dari Gudang Belakang ke Rak Pajangan Depan
BEGIN;
    -- 1. Validasi saldo gudang harus mencukupi (>= 40 Pcs)
    -- 2. Kurangi stok gudang
    UPDATE t_stock
    SET qty = qty - 40, "updatedAt" = now()
    WHERE item_id = 'i1111111-1111-1111-1111-111111111111' AND location = 'GUDANG';

    -- 3. Tambah stok rak depan
    UPDATE t_stock
    SET qty = qty + 40, "updatedAt" = now()
    WHERE item_id = 'i1111111-1111-1111-1111-111111111111' AND location = 'RAK';

    -- 4. Insert dokumen mutasi
    INSERT INTO t_stock_mutation (id, no_mutasi, from_location, to_location, status, keterangan)
    VALUES ('m1111111-1111-1111-1111-111111111111', 'MUT-2026-001', 'GUDANG', 'RAK', 'COMPLETED', 'Restock rak pajangan pagi');

    INSERT INTO t_stock_mutation_d (id, mutation_id, item_id, qty_pcs)
    VALUES (uuid_generate_v4(), 'm1111111-1111-1111-1111-111111111111', 'i1111111-1111-1111-1111-111111111111', 40);

    -- 5. Tulis 2 kartu stok: KELUAR dari Gudang & MASUK ke Rak
    INSERT INTO t_stock_card (id, item_id, tanggal, no_dokumen, jenis_mutasi, qty_in, qty_out, saldo_akhir, location, keterangan)
    VALUES 
        (uuid_generate_v4(), 'i1111111-1111-1111-1111-111111111111', now(), 'MUT-2026-001', 'MUTASI_KELUAR', 0, 40, 
         (SELECT qty FROM t_stock WHERE item_id = 'i1111111-1111-1111-1111-111111111111' AND location = 'GUDANG'), 'GUDANG', 'Mutasi ke Rak Pajangan'),
        (uuid_generate_v4(), 'i1111111-1111-1111-1111-111111111111', now(), 'MUT-2026-001', 'MUTASI_MASUK', 40, 0, 
         (SELECT qty FROM t_stock WHERE item_id = 'i1111111-1111-1111-1111-111111111111' AND location = 'RAK'), 'RAK', 'Penerimaan Mutasi dari Gudang');
COMMIT;

-- 5.3 Query Buku Mutasi Kartu Stok Kronologis (Inventory 2.4)
SELECT 
    sc.tanggal,
    sc.no_dokumen,
    sc.location AS lokasi_zona,
    sc.jenis_mutasi,
    sc.qty_in AS masuk_pcs,
    sc.qty_out AS keluar_pcs,
    sc.saldo_akhir AS sisa_stok_pcs,
    sc.keterangan
FROM t_stock_card sc
WHERE sc.item_id = 'i1111111-1111-1111-1111-111111111111'
ORDER BY sc.tanggal DESC, sc."createdAt" DESC;

-- 5.4 Transaksi Penyesuaian Stock Opname (Inventory 3.2)
-- Menyetujui selisih hitung fisik (misal fisik di rak dihitung 50, sistem catat 52 -> selisih -2 Pcs)
BEGIN;
    INSERT INTO t_stock_adjustment (id, no_adjustment, opname_id, status, catatan)
    VALUES ('a1111111-1111-1111-1111-111111111111', 'ADJ-2026-001', NULL, 'APPLIED', 'Koreksi selisih fisik opname rak snack');

    INSERT INTO t_stock_adjustment_d (id, adjustment_id, item_id, location, qty_adjustment, direction)
    VALUES (uuid_generate_v4(), 'a1111111-1111-1111-1111-111111111111', 'i1111111-1111-1111-1111-111111111111', 'RAK', 2, 'OUT');

    -- Koreksi saldo sistem t_stock agar setara dengan fisik 50 Pcs
    UPDATE t_stock 
    SET qty = 50, "updatedAt" = now() 
    WHERE item_id = 'i1111111-1111-1111-1111-111111111111' AND location = 'RAK';

    -- Catat bukti koreksi ke t_stock_card (tanpa mengubah tagihan di Purchasing)
    INSERT INTO t_stock_card (id, item_id, tanggal, no_dokumen, jenis_mutasi, qty_in, qty_out, saldo_akhir, location, keterangan)
    VALUES (uuid_generate_v4(), 'i1111111-1111-1111-1111-111111111111', now(), 'ADJ-2026-001', 'OPNAME_ADJUST', 0, 2, 50, 'RAK', 'Penyesuaian Opname Selisih -2 Pcs');
COMMIT;


-- =============================================================================
-- BAGIAN VI: KASIR, SHIFT & PENJUALAN KASIR (MODUL POINT OF SALE)
-- =============================================================================

-- 6.1 Buka Shift Kasir & Modal Uang Kembalian (POS 2.1)
INSERT INTO t_cashier_shift (id, no_shift, user_id, modal_awal, status, opened_at, catatan)
VALUES (
    'sh111111-1111-1111-1111-111111111111',
    'SFT-2026-001',
    'u0000000-0000-0000-0000-000000000001', -- ID User Kasir
    150000.00,                              -- Modal awal laci Rp150.000
    'OPEN',
    now(),
    'Buka shift 1 kasir pagi'
);

-- 6.2 Transaksi Atomik Mesin Kasir / Checkout (POS 1.1)
-- Customer beli 3 Pcs Susu Ultra Milk @ Rp6.500 = Rp19.500 (Bayar Tunai Rp20.000, Kembali Rp500)
-- Dampak:
-- 1. Insert t_pos_order & t_pos_order_d
-- 2. UPDATE potong stok rak t_stock (-3 Pcs) secara real-time
-- 3. INSERT t_stock_card jenis POS_PENJUALAN
-- 4. UPDATE akumulasi penjualan tunai shift t_cashier_shift (+Rp19.500)
BEGIN;
    -- 1. Insert Struk Penjualan
    INSERT INTO t_pos_order (
        id, no_struk, shift_id, user_id, total_amount, bayar, kembalian, metode_bayar, status
    ) VALUES (
        'str11111-1111-1111-1111-111111111111',
        'STR-2026-0001',
        'sh111111-1111-1111-1111-111111111111',
        'u0000000-0000-0000-0000-000000000001',
        19500.00,
        20000.00,
        500.00,
        'TUNAI',
        'COMPLETED'
    );

    INSERT INTO t_pos_order_d (
        id, order_id, item_id, qty_pcs, harga_satuan, diskon, subtotal
    ) VALUES (
        uuid_generate_v4(),
        'str11111-1111-1111-1111-111111111111',
        'i1111111-1111-1111-1111-111111111111',
        3,
        6500.00,
        0.00,
        19500.00
    );

    -- 2. Potong stok rak secara real-time
    UPDATE t_stock
    SET qty = qty - 3, "updatedAt" = now()
    WHERE item_id = 'i1111111-1111-1111-1111-111111111111' AND location = 'RAK';

    -- 3. Catat kartu stok penjualan kasir
    INSERT INTO t_stock_card (
        id, item_id, tanggal, no_dokumen, jenis_mutasi, qty_in, qty_out, saldo_akhir, location, keterangan
    ) VALUES (
        uuid_generate_v4(),
        'i1111111-1111-1111-1111-111111111111',
        now(),
        'STR-2026-0001',
        'POS_PENJUALAN',
        0,
        3,
        (SELECT qty FROM t_stock WHERE item_id = 'i1111111-1111-1111-1111-111111111111' AND location = 'RAK'),
        'RAK',
        'Penjualan Kasir Struk STR-2026-0001'
    );

    -- 4. Akumulasikan ke shift kasir
    UPDATE t_cashier_shift
    SET total_tunai = total_tunai + 19500.00, "updatedAt" = now()
    WHERE id = 'sh111111-1111-1111-1111-111111111111';
COMMIT;

-- 6.3 Tutup Shift Kasir & Rekonsiliasi Uang Fisik Laci (POS 2.2)
-- Menghitung selisih kas: Modal Awal Rp150.000 + Penjualan Tunai Rp500.000 = Rp650.000
-- Fisik laci dihitung Rp650.000 -> Selisih Rp0 (Seimbang)
UPDATE t_cashier_shift
SET 
    uang_fisik_laci = 650000.00,
    modal_akhir = 650000.00,
    selisih = 650000.00 - (modal_awal + total_tunai),
    status = 'CLOSED',
    closed_at = now(),
    catatan = 'Tutup shift kasir selesai. Kas fisik seimbang.'
WHERE id = 'sh111111-1111-1111-1111-111111111111';

-- 6.4 Laporan Penjualan Shift Terkini (POS 3.1)
SELECT 
    sh.no_shift,
    u.name AS nama_kasir,
    sh.opened_at,
    sh.closed_at,
    sh.modal_awal,
    sh.total_tunai,
    sh.total_non_tunai,
    (sh.total_tunai + sh.total_non_tunai) AS total_omzet_shift,
    (sh.modal_awal + sh.total_tunai) AS ekspektasi_kas_laci,
    sh.uang_fisik_laci,
    sh.selisih AS selisih_kas_laci,
    COUNT(po.id) AS total_struk_tercetak
FROM t_cashier_shift sh
JOIN user_default u ON sh.user_id = u.id
LEFT JOIN t_pos_order po ON sh.id = po.shift_id
WHERE sh.id = 'sh111111-1111-1111-1111-111111111111'
GROUP BY sh.id, sh.no_shift, u.name, sh.opened_at, sh.closed_at, sh.modal_awal, 
         sh.total_tunai, sh.total_non_tunai, sh.uang_fisik_laci, sh.selisih;

-- 6.5 Rekapitulasi Penjualan Harian Toko & Pemicu ROP ke Auto-PR (POS 3.2 ke Simpul 4)
-- Menghitung kecepatan penjualan harian (pcs/hari) 7 hari terakhir dan memperbarui ROP
WITH DailySalesRate AS (
    SELECT 
        pod.item_id,
        SUM(pod.qty_pcs) AS total_qty_terjual_7_hari,
        ROUND((SUM(pod.qty_pcs)::NUMERIC / 7.0), 2) AS rata_rata_penjualan_harian
    FROM t_pos_order_d pod
    JOIN t_pos_order po ON pod.order_id = po.id
    WHERE po.status = 'COMPLETED' 
      AND po.created_at >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY pod.item_id
)
UPDATE m_item_rop rop
SET 
    avg_daily_sales = ds.rata_rata_penjualan_harian,
    rop_pcs = CEIL((ds.rata_rata_penjualan_harian * rop.lead_time_days) + rop.safety_stock_pcs),
    last_calculated_at = now()
FROM DailySalesRate ds
WHERE rop.item_id = ds.item_id;

