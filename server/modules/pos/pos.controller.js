import { wrap } from "../../../src/core/utils/helpers.js";
import * as posService from "./pos.service.js";

// =============================================================================
// POINT OF SALE (POS) CONTROLLER
// =============================================================================

// 2.1 Buka Shift Kasir
export const postOpenShift = wrap(async (req, res) => {
  const data = await posService.openCashierShift(req.body, req.user?.id);
  res.status(201).json({ status: "success", message: "Shift kasir berhasil dibuka", data });
});

export const getActiveShift = wrap(async (req, res) => {
  const data = await posService.getActiveCashierShift(req.user?.id, req.user);
  res.json({ status: "success", data });
});

// Riwayat transaksi pada shift aktif (hanya milik kasir yang login)
export const getActiveShiftOrders = wrap(async (req, res) => {
  const data = await posService.getActiveShiftOrders(req.user, req.query);
  res.json({ status: "success", data });
});

// 1.1 Mesin Kasir / Checkout [Krusial 5]
export const postCheckout = wrap(async (req, res) => {
  const data = await posService.executePosCheckoutTransaction(req.body, req.user);
  res.status(201).json({ status: "success", message: "Transaksi kasir berhasil, saldo rak dipotong seketika", data });
});

// 2.2 Tutup Shift & Rekonsiliasi Kas
export const postCloseShift = wrap(async (req, res) => {
  const data = await posService.closeCashierShift(req.params.id, req.body, req.user);
  res.json({ status: "success", message: "Shift kasir berhasil ditutup dan kas direkonsiliasi", data });
});

// 3.1 Laporan Penjualan Shift Terkini
export const getShiftReport = wrap(async (req, res) => {
  const data = await posService.getShiftReport(req.params.id, req.user);
  res.json({ status: "success", data });
});

// 3.2 Rekap Penjualan Harian Toko & Pemicu ROP [Krusial 6]
export const getDailySalesSummary = wrap(async (req, res) => {
  const data = await posService.getDailySalesAndTriggerRop(req.query);
  res.json({ status: "success", data });
});

