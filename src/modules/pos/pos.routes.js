import { Router } from "express";
import {
  authenticate,
  managerOnly,
  requireRoles,
  validateGuidParam,
} from "../../core/middlewares/auth.js";
import {
  settings,
  settingsPublic,
  saveSettings,
  products,
  listShifts,
  getShift,
  getShiftSummary,
  openShift,
  closeShift,
  checkout,
  listOrders,
  getOrder,
  getReceipt,
  voidOrder,
  createHold,
  listHolds,
  takeHold,
  deleteHold,
  listPosReturns,
  getPosReturn,
  createPosReturn,
  approvePosReturn,
  rejectPosReturn,
  salesReport,
  shiftSalesReport,
} from "./pos.controller.js";

const router = Router();
router.use(authenticate);

const cashierRoles = requireRoles("KASIR", "ADMIN");
const adminOnly = requireRoles("ADMIN");

/* ---------- Pengaturan toko ---------- */
router.get("/settings/public", settingsPublic);
router.get("/settings", managerOnly, settings);
router.put("/settings", adminOnly, saveSettings);

/* ---------- Produk untuk kasir ---------- */
router.get("/products", cashierRoles, products);

/* ---------- Shift kasir ---------- */
router.get("/shifts", listShifts);
router.post("/shifts/open", cashierRoles, openShift);
router.get(
  "/shifts/:id/summary",
  validateGuidParam("shift"),
  managerOnly,
  getShiftSummary,
);
router.get(
  "/shifts/:id/report",
  validateGuidParam("shift"),
  managerOnly,
  shiftSalesReport,
);
router.post(
  "/shifts/:id/close",
  validateGuidParam("shift"),
  cashierRoles,
  closeShift,
);
router.get("/shifts/:id", validateGuidParam("shift"), getShift);

/* ---------- Checkout & transaksi ---------- */
router.get("/orders", listOrders);
router.post("/orders", cashierRoles, checkout);
router.get(
  "/orders/:id/receipt",
  validateGuidParam("transaksi"),
  getReceipt,
);
router.post(
  "/orders/:id/void",
  validateGuidParam("transaksi"),
  managerOnly,
  voidOrder,
);
router.get("/orders/:id", validateGuidParam("transaksi"), getOrder);

/* ---------- Hold / resume ---------- */
router.get("/holds", listHolds);
router.post("/holds", cashierRoles, createHold);
router.post(
  "/holds/:id/take",
  validateGuidParam("hold"),
  cashierRoles,
  takeHold,
);
router.delete("/holds/:id", validateGuidParam("hold"), deleteHold);

/* ---------- Retur penjualan (opsional) ---------- */
router.get("/returns", listPosReturns);
router.get("/returns/:id", validateGuidParam("retur"), getPosReturn);
router.post("/returns", cashierRoles, createPosReturn);
router.post(
  "/returns/:id/approve",
  validateGuidParam("retur"),
  managerOnly,
  approvePosReturn,
);
router.post(
  "/returns/:id/reject",
  validateGuidParam("retur"),
  managerOnly,
  rejectPosReturn,
);

/* ---------- Laporan ---------- */
router.get("/reports/sales", managerOnly, salesReport);

export default router;
