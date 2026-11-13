import { Router } from "express";
import { authenticate, requireRoles, validateGuidParam } from "../../../src/core/middlewares/auth.js";
import * as controller from "./purchasing.controller.js";

const router = Router();
router.use(authenticate);
// P2 #13: modul purchasing memuat harga beli, utang, dan dokumen finansial.
// Kasir tidak boleh mengaksesnya; Gudang hanya untuk operasional.
router.use(requireRoles("GUDANG", "ADMIN", "SUPER_ADMIN"));

const adminOnly = requireRoles("ADMIN", "SUPER_ADMIN");
const purchasingRoles = requireRoles("ADMIN", "SUPER_ADMIN", "GUDANG");

// -----------------------------------------------------------------------------
// TAHAP 1: PERSIAPAN DATA PEMASOK & HARGA MODAL (KELOMPOK 1)
// -----------------------------------------------------------------------------
// 1.1 Daftar Supplier (/purchasing/master/suppliers)
router.get("/suppliers", controller.getSuppliers);
router.get("/suppliers/:id", validateGuidParam("supplier"), controller.getSupplierDetail);
router.post("/suppliers", adminOnly, controller.postSupplier);
router.put("/suppliers/:id", validateGuidParam("supplier"), adminOnly, controller.putSupplier);
router.delete("/suppliers/:id", validateGuidParam("supplier"), adminOnly, controller.deleteSupplier);

// 1.2 Katalog Harga & Produk Supplier (/purchasing/master/supplier-catalogs)
router.get("/supplier-catalogs", controller.getSupplierCatalogs);
router.post("/supplier-catalogs", adminOnly, controller.postSupplierCatalog);
router.delete("/supplier-catalogs/:id", validateGuidParam("katalog"), adminOnly, controller.deleteSupplierCatalog);

// -----------------------------------------------------------------------------
// TAHAP 2: DETEKSI STOK TIPIS & PEMESANAN BARANG (KELOMPOK 2)
// -----------------------------------------------------------------------------
// 2.1 Rekomendasi Belanja Otomatis / Auto-PR (/purchasing/order/auto-pr)
router.get("/auto-pr", controller.getPurchaseRequests);
router.post("/auto-pr/convert-to-po", purchasingRoles, controller.postConvertAutoPrToPo);

// 2.2 Buat & Kelola Purchase Order (/purchasing/order/purchase-orders)
router.get("/purchase-orders", controller.getPurchaseOrders);
router.get("/purchase-orders/:id", validateGuidParam("po"), controller.getPurchaseOrderDetail);
router.post("/purchase-orders", purchasingRoles, controller.postPurchaseOrder);
router.post("/purchase-orders/:id/send", validateGuidParam("po"), purchasingRoles, controller.postSendPoDocument);

// 2.3 Pantau Status Pesanan / Tracking PO (/purchasing/order/tracking)
router.get("/purchase-orders/:id/tracking", validateGuidParam("po"), controller.getPoTracking);

// -----------------------------------------------------------------------------
// TAHAP 3: PENERIMAAN FISIK DI GUDANG & RETUR BARANG RUSAK (KELOMPOK 3)
// -----------------------------------------------------------------------------
// 3.1 Input Barang Masuk / Goods Receipt (/purchasing/receiving/goods-receipts)
router.get("/goods-receipts", controller.getGoodsReceipts);
router.get("/goods-receipts/:id", validateGuidParam("goods-receipt"), controller.getGoodsReceiptDetail);
router.post("/goods-receipts", purchasingRoles, controller.postGoodsReceipt);

// 3.2 Retur Pembelian / Barang Rusak & Expired (/purchasing/receiving/purchase-returns)
router.get("/purchase-returns", controller.getPurchaseReturns);
router.post("/purchase-returns", purchasingRoles, controller.postPurchaseReturn);

// -----------------------------------------------------------------------------
// TAHAP 4: VERIFIKASI TAGIHAN & PELUNASAN HUTANG (KELOMPOK 4)
// -----------------------------------------------------------------------------
// 4.1 Verifikasi Nota Supplier / 3-Way Matching (/purchasing/invoicing/invoices)
router.get("/invoices/preview/:po_id", validateGuidParam("po_id"), adminOnly, controller.getMatchingPreview);
router.get("/invoices", adminOnly, controller.getPurchaseInvoices);
router.post("/invoices", adminOnly, controller.postPurchaseInvoice);

// 4.2 Jadwal Jatuh Tempo & Alarm TOP / Tandai Lunas (/purchasing/invoicing/payables & payments)
router.get("/payables", adminOnly, controller.getPayablesSchedule);
router.post("/payments", adminOnly, controller.postPurchasePayment);
router.post("/invoices/:id/mark-paid", validateGuidParam("invoice"), adminOnly, controller.postMarkInvoicePaid);

// -----------------------------------------------------------------------------
// TAHAP 5: REKAPITULASI PENGELUARAN MODAL TOKO (KELOMPOK 5)
// -----------------------------------------------------------------------------
// 5.1 Laporan Riwayat Pembelian (/purchasing/reports/purchases)
router.get("/reports/purchase-history", adminOnly, controller.getPurchaseHistoryReport);

// (Sub-modul 5.2 DIHAPUS SEPENUHNYA SESUAI SPESIFIKASI FINAL)

export default router;
