import { Router } from "express";
import { authenticate, requireRoles, validateGuidParam } from "../../../src/core/middlewares/auth.js";
import * as controller from "./inventory.controller.js";

const router = Router();
router.use(authenticate);

const adminOnly = requireRoles("ADMIN", "SUPER_ADMIN");
const warehouseRoles = requireRoles("GUDANG", "ADMIN", "SUPER_ADMIN");
// Laporan barang rusak hanya untuk GUDANG/ADMIN. Kasir fokus pada transaksi POS.
const damagedReportRoles = requireRoles("GUDANG", "ADMIN", "SUPER_ADMIN");

// 1.2 Kategori & Rak (/inventory/master/category-racks)
router.get("/category-racks", controller.getCategoryRacks);
router.post("/category-racks", adminOnly, controller.postCategoryRack);
router.put("/category-racks/:id", validateGuidParam("kategori-rak"), adminOnly, controller.putCategoryRack);
router.delete("/category-racks/:id", validateGuidParam("kategori-rak"), adminOnly, controller.deleteCategoryRack);

// 1.3 Satuan & Konversi (/inventory/master/uoms)
router.get("/uoms", controller.getUoms);
router.post("/uoms", adminOnly, controller.postUom);
router.put("/uoms/:id", validateGuidParam("uom"), adminOnly, controller.putUom);
router.delete("/uoms/:id", validateGuidParam("uom"), adminOnly, controller.deleteUom);

// 1.1 Daftar Barang (/inventory/master/items)
router.get("/items", controller.getItems);
router.get("/items/barcode/:barcode", controller.getItemByBarcode);
router.get("/items/:id", validateGuidParam("barang"), controller.getItemById);
router.post("/items", adminOnly, controller.postItem);
router.put("/items/:id", validateGuidParam("barang"), adminOnly, controller.putItem);
router.delete("/items/:id", validateGuidParam("barang"), adminOnly, controller.deleteItem);

// 2.1 Posisi Stok Real-Time (/inventory/stok/positions)
router.get("/stocks", controller.getStocks);

// 2.4 Kartu Stok Kronologis (/inventory/stok/cards)
router.get("/stock-cards", controller.getStockCards);

// 2.2 Mutasi Gudang ke Rak [Krusial 2] (/inventory/stok/mutations)
router.post("/mutations", warehouseRoles, controller.postStockMutation);

// 2.3 Barang Rusak / Hilang [Krusial 3] (/inventory/stok/damaged)
router.get("/damaged", controller.getDamagedStocks);
router.post("/damaged", damagedReportRoles, controller.postStockDamaged);

// 3.1 Hitung Fisik (/inventory/opname/fisik)
router.get("/opnames", warehouseRoles, controller.getStockOpnames);
router.get("/opnames/:id", validateGuidParam("opname"), warehouseRoles, controller.getStockOpnameDetail);
router.post("/opnames", warehouseRoles, controller.postStockOpnameDraft);
router.put("/opnames/:id/counts", validateGuidParam("opname"), warehouseRoles, controller.putStockOpnameCounts);
router.delete("/opnames/:id", validateGuidParam("opname"), adminOnly, controller.deleteStockOpnameDraft);

// 3.2 Penyesuaian Stok [Krusial 4] (/inventory/opname/adjustment)
router.get("/adjustments", warehouseRoles, controller.getStockAdjustments);
router.post("/opnames/:id/adjust", validateGuidParam("opname"), adminOnly, controller.postStockAdjustment);

// 1.4 Batas Pemesanan Barang / ROP (/inventory/rop)
router.get("/rop", controller.getRopSettings);
router.put("/rop/:item_id", validateGuidParam("item_id"), adminOnly, controller.putRopSetting);

export default router;

