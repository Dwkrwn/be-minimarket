import { wrap } from "../../../src/core/utils/helpers.js";
import * as purchasingService from "./purchasing.service.js";

// =============================================================================
// MODUL PURCHASING CONTROLLER (Versi Revisi Alur: Tanpa Sub-Modul 5.2)
// =============================================================================

// -----------------------------------------------------------------------------
// TAHAP 1: PERSIAPAN DATA PEMASOK & HARGA MODAL (KELOMPOK 1)
// -----------------------------------------------------------------------------

// 1.1 Daftar Supplier
export const getSuppliers = wrap(async (req, res) => {
  const data = await purchasingService.listSuppliers(req.query);
  res.json({ status: "success", data });
});

export const getSupplierDetail = wrap(async (req, res) => {
  const data = await purchasingService.getSupplierDetail(req.params.id);
  res.json({ status: "success", data });
});

export const postSupplier = wrap(async (req, res) => {
  const data = await purchasingService.createSupplier(req.body);
  res.status(201).json({ status: "success", message: "Distributor supplier berhasil didaftarkan", data });
});

export const putSupplier = wrap(async (req, res) => {
  const data = await purchasingService.updateSupplier(req.params.id, req.body);
  res.json({ status: "success", message: "Data supplier berhasil diperbarui", data });
});

export const deleteSupplier = wrap(async (req, res) => {
  await purchasingService.deleteSupplier(req.params.id);
  res.json({ status: "success", message: "Data supplier berhasil dihapus" });
});

// 1.2 Katalog Harga & Produk Supplier
export const getSupplierCatalogs = wrap(async (req, res) => {
  const data = await purchasingService.listSupplierCatalogs(req.query);
  res.json({ status: "success", data });
});

export const postSupplierCatalog = wrap(async (req, res) => {
  const data = await purchasingService.createOrUpdateSupplierCatalog(req.body);
  res.status(201).json({ status: "success", message: "Harga modal (HPP) distributor berhasil disimpan", data });
});

export const deleteSupplierCatalog = wrap(async (req, res) => {
  await purchasingService.deleteSupplierCatalog(req.params.id);
  res.json({ status: "success", message: "Katalog harga distributor berhasil dihapus" });
});

// -----------------------------------------------------------------------------
// TAHAP 2: DETEKSI STOK TIPIS & PEMESANAN BARANG (KELOMPOK 2)
// -----------------------------------------------------------------------------

// 2.1 Rekomendasi Belanja Otomatis (Auto-PR)
export const getPurchaseRequests = wrap(async (req, res) => {
  const data = await purchasingService.listPurchaseRequests(req.query);
  res.json({ status: "success", data });
});

export const postConvertAutoPrToPo = wrap(async (req, res) => {
  const data = await purchasingService.convertAutoPrToPo(req.body, req.user?.id);
  res.status(201).json({ status: "success", message: "Surat Pesanan (PO) berhasil diterbitkan ke supplier termurah", data });
});

// 2.2 Buat & Kelola Purchase Order (PO)
export const getPurchaseOrders = wrap(async (req, res) => {
  const data = await purchasingService.listPurchaseOrders(req.query);
  res.json({ status: "success", data });
});

export const getPurchaseOrderDetail = wrap(async (req, res) => {
  const data = await purchasingService.getPurchaseOrderDetail(req.params.id);
  res.json({ status: "success", data });
});

export const postPurchaseOrder = wrap(async (req, res) => {
  const data = await purchasingService.createPurchaseOrder(req.body, req.user?.id);
  res.status(201).json({ status: "success", message: "Purchase Order resmi berhasil diterbitkan", data });
});

export const postSendPoDocument = wrap(async (req, res) => {
  const data = await purchasingService.sendPurchaseOrderDocument(req.params.id, req.body.channel);
  res.json({ status: "success", message: "Draf dokumen PO dan pesan WA/Email sales siap dikirimkan", data });
});

// 2.3 Pantau Status Pesanan (Tracking PO)
export const getPoTracking = wrap(async (req, res) => {
  const data = await purchasingService.trackPurchaseOrder(req.params.id);
  res.json({ status: "success", data });
});

// -----------------------------------------------------------------------------
// TAHAP 3: PENERIMAAN FISIK DI GUDANG & RETUR BARANG RUSAK (KELOMPOK 3)
// -----------------------------------------------------------------------------

// 3.1 Input Barang Masuk (Goods Receipt)
export const getGoodsReceipts = wrap(async (req, res) => {
  const data = await purchasingService.listGoodsReceipts(req.query);
  res.json({ status: "success", data });
});

export const getGoodsReceiptDetail = wrap(async (req, res) => {
  const data = await purchasingService.getGoodsReceiptDetail(req.params.id);
  res.json({ status: "success", data });
});

export const postGoodsReceipt = wrap(async (req, res) => {
  const data = await purchasingService.executeGoodsReceiptTransaction(req.body, req.user?.id);
  res.status(201).json({
    status: "success",
    message: "Fisik barang masuk diverifikasi, stok inventory otomatis bertambah, status PO diperbarui, dan bukti siap diteruskan ke Verifikasi Nota",
    data,
  });
});

// 3.2 Retur Pembelian (Barang Rusak / Expired)
export const postPurchaseReturn = wrap(async (req, res) => {
  const data = await purchasingService.createPurchaseReturn(req.body, req.user?.id);
  res.status(201).json({
    status: "success",
    message: "Retur barang cacat/expired berhasil diproses, stok toko dipotong, dan Nota Potong Tagihan diterbitkan",
    data,
  });
});

export const getPurchaseReturns = wrap(async (req, res) => {
  const data = await purchasingService.listPurchaseReturns(req.query);
  res.json({ status: "success", data });
});

// -----------------------------------------------------------------------------
// TAHAP 4: VERIFIKASI TAGIHAN & PELUNASAN HUTANG (KELOMPOK 4)
// -----------------------------------------------------------------------------

// 4.1 Verifikasi Nota Supplier (3-Way Matching)
export const getMatchingPreview = wrap(async (req, res) => {
  const data = await purchasingService.getThreeWayMatchingPreview(req.params.po_id);
  res.json({ status: "success", data });
});

export const postPurchaseInvoice = wrap(async (req, res) => {
  const data = await purchasingService.createPurchaseInvoice(req.body, req.user?.id);
  res.status(201).json({
    status: "success",
    message:
      "Verifikasi 3 dokumen selesai: satu invoice PO terbentuk dari seluruh Goods Receipt dan retur, nominal tagihan bersih dikunci, dan jadwal jatuh tempo dibuat",
    data,
  });
});

export const getPurchaseInvoices = wrap(async (req, res) => {
  const data = await purchasingService.listPurchaseInvoices(req.query);
  res.json({ status: "success", data });
});

// 4.2 Jadwal Jatuh Tempo & Alarm Hitung Mundur TOP / Tandai Lunas
export const getPayablesSchedule = wrap(async (req, res) => {
  const data = await purchasingService.listPayablesSchedule(req.query);
  res.json({ status: "success", data });
});

export const postPurchasePayment = wrap(async (req, res) => {
  const data = await purchasingService.createPurchasePayment(req.body, req.user?.id);
  res.status(201).json({ status: "success", message: "Pembayaran tagihan distributor berhasil dibukukan", data });
});

export const postMarkInvoicePaid = wrap(async (req, res) => {
  const payload = { invoice_id: req.params.id, ...req.body };
  const data = await purchasingService.createPurchasePayment(payload, req.user?.id);
  res.json({ status: "success", message: "Tagihan supplier berhasil Ditandai Lunas", data });
});

// -----------------------------------------------------------------------------
// TAHAP 5: REKAPITULASI PENGELUARAN MODAL TOKO (KELOMPOK 5)
// -----------------------------------------------------------------------------

// 5.1 Laporan Riwayat Pembelian (Satu-satunya laporan resmi purchasing)
export const getPurchaseHistoryReport = wrap(async (req, res) => {
  const data = await purchasingService.getPurchaseHistoryReport(req.query);
  res.json({ status: "success", data });
});
