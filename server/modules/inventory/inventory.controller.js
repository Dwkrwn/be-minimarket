import { wrap } from "../../../src/core/utils/helpers.js";
import * as inventoryService from "./inventory.service.js";

// =============================================================================
// INVENTORY CONTROLLER
// =============================================================================

// 1.2 Kategori & Rak
export const getCategoryRacks = wrap(async (req, res) => {
  const data = await inventoryService.listCategoryRacks(req.query);
  res.json({ status: "success", data });
});

export const postCategoryRack = wrap(async (req, res) => {
  const data = await inventoryService.createCategoryRack(req.body);
  res.status(201).json({ status: "success", message: "Kategori/Rak berhasil dibuat", data });
});

export const putCategoryRack = wrap(async (req, res) => {
  const data = await inventoryService.updateCategoryRack(req.params.id, req.body);
  res.json({ status: "success", message: "Kategori/Rak berhasil diperbarui", data });
});

export const deleteCategoryRack = wrap(async (req, res) => {
  await inventoryService.deleteCategoryRack(req.params.id);
  res.json({ status: "success", message: "Kategori/Rak berhasil dihapus" });
});

// 1.3 Satuan & Konversi
export const getUoms = wrap(async (req, res) => {
  const data = await inventoryService.listUoms(req.query);
  res.json({ status: "success", data });
});

export const postUom = wrap(async (req, res) => {
  const data = await inventoryService.createUom(req.body);
  res.status(201).json({ status: "success", message: "Satuan UOM berhasil dibuat", data });
});

export const putUom = wrap(async (req, res) => {
  const data = await inventoryService.updateUom(req.params.id, req.body);
  res.json({ status: "success", message: "Satuan UOM berhasil diperbarui", data });
});

export const deleteUom = wrap(async (req, res) => {
  await inventoryService.deleteUom(req.params.id);
  res.json({ status: "success", message: "Satuan UOM berhasil dihapus" });
});

// 1.1 Master Barang
export const getItems = wrap(async (req, res) => {
  const data = await inventoryService.listItems(req.query, req.user);
  res.json({ status: "success", data });
});

export const getItemByBarcode = wrap(async (req, res) => {
  const data = await inventoryService.getItemByBarcode(req.params.barcode, req.user);
  res.json({ status: "success", data });
});

export const getItemById = wrap(async (req, res) => {
  const data = await inventoryService.getItemById(req.params.id, req.user);
  res.json({ status: "success", data });
});

export const postItem = wrap(async (req, res) => {
  const data = await inventoryService.createItem(req.body);
  res.status(201).json({ status: "success", message: "Barang berhasil ditambahkan", data });
});

export const putItem = wrap(async (req, res) => {
  const data = await inventoryService.updateItem(req.params.id, req.body);
  res.json({ status: "success", message: "Barang berhasil diperbarui", data });
});

export const deleteItem = wrap(async (req, res) => {
  await inventoryService.deleteItem(req.params.id);
  res.json({ status: "success", message: "Barang berhasil dihapus" });
});

// 2.1 Posisi Stok
export const getStocks = wrap(async (req, res) => {
  const data = await inventoryService.getStockPositions(req.query, req.user);
  res.json({ status: "success", data });
});

// 2.4 Kartu Stok
export const getStockCards = wrap(async (req, res) => {
  const result = await inventoryService.getStockCards(req.query, req.user);
  res.json({ status: "success", ...result });
});

// 2.2 Mutasi Gudang ke Rak (Krusial 2)
export const postStockMutation = wrap(async (req, res) => {
  const data = await inventoryService.executeStockMutationTransaction(req.body, req.user?.id);
  res.status(201).json({ status: "success", message: "Mutasi stok Gudang ke Rak berhasil dieksekusi", data });
});

// 2.3 Barang Rusak / Hilang (Krusial 3)
export const postStockDamaged = wrap(async (req, res) => {
  const data = await inventoryService.executeStockDamagedTransaction(req.body, req.user);
  res.status(201).json({ status: "success", message: "Laporan barang rusak berhasil diproses dan stok dipotong", data });
});

export const getDamagedStocks = wrap(async (req, res) => {
  const data = await inventoryService.listDamagedStocks(req.query, req.user);
  res.json({ status: "success", data });
});

// 3.1 Stock Opname
export const getStockOpnames = wrap(async (req, res) => {
  const result = await inventoryService.listStockOpnames(req.query);
  res.json({ status: "success", ...result });
});

export const getStockOpnameDetail = wrap(async (req, res) => {
  const data = await inventoryService.getStockOpnameDetail(req.params.id, req.user);
  res.json({ status: "success", data });
});

export const postStockOpnameDraft = wrap(async (req, res) => {
  const data = await inventoryService.createStockOpnameDraft(req.body, req.user?.id);
  res.status(201).json({ status: "success", message: "Draft lembar stock opname berhasil dibuat", data });
});

export const putStockOpnameCounts = wrap(async (req, res) => {
  const data = await inventoryService.submitStockOpnameCounts(req.params.id, req.body.counts, req.user?.id);
  res.json({ status: "success", message: "Hasil hitung fisik lapangan berhasil disimpan", data });
});

export const deleteStockOpnameDraft = wrap(async (req, res) => {
  const data = await inventoryService.deleteStockOpnameDraft(req.params.id);
  res.json({
    status: "success",
    message: `Draft opname ${data.no_opname} berhasil dihapus`,
    data,
  });
});

// 3.2 Penyesuaian Stok (Krusial 4)
export const getStockAdjustments = wrap(async (req, res) => {
  const result = await inventoryService.listStockAdjustments(req.query, req.user);
  res.json({ status: "success", ...result });
});

export const postStockAdjustment = wrap(async (req, res) => {
  const data = await inventoryService.executeStockAdjustmentTransaction(req.params.id, req.user?.id, req.body.catatan);
  const message = data.adjustment
    ? "Penyesuaian stok opname berhasil diaplikasikan secara atomik"
    : "Tidak ada selisih fisik. Opname disetujui tanpa penyesuaian stok";
  res.json({ status: "success", message, data });
});

// 4.1 ROP
export const getRopSettings = wrap(async (req, res) => {
  const data = await inventoryService.getRopSettings(req.query, req.user);
  res.json({ status: "success", data });
});

export const putRopSetting = wrap(async (req, res) => {
  const data = await inventoryService.updateRopSetting(req.params.item_id, req.body);
  res.json({ status: "success", message: "Pengaturan batas pemesanan (ROP) berhasil diperbarui", data });
});

