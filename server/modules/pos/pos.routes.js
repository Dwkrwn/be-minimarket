import { Router } from "express";
import { authenticate, requireRoles, validateGuidParam } from "../../../src/core/middlewares/auth.js";
import * as controller from "./pos.controller.js";

const router = Router();
router.use(authenticate);

const cashierRoles = requireRoles("KASIR", "ADMIN", "SUPER_ADMIN");
const managerRoles = requireRoles("ADMIN", "SUPER_ADMIN");

// 2.1 Buka Shift Kasir (/pos/shift/open)
router.post("/shifts/open", cashierRoles, controller.postOpenShift);
router.get("/shifts/active", cashierRoles, controller.getActiveShift);

// 1.1 Mesin Kasir / Checkout [Krusial 5] (/pos/kasir/checkout)
router.post("/checkout", cashierRoles, controller.postCheckout);

// 2.2 Tutup Shift & Rekonsiliasi (/pos/shift/close)
router.post("/shifts/:id/close", validateGuidParam("shift"), cashierRoles, controller.postCloseShift);

// 3.1 Laporan Penjualan Shift Terkini (/pos/reports/current-shift)
router.get("/shifts/:id/report", validateGuidParam("shift"), cashierRoles, controller.getShiftReport);

// 3.2 Rekap Penjualan Harian Toko & Pemicu ROP [Krusial 6] (/pos/reports/daily-sales)
router.get("/reports/daily-sales", managerRoles, controller.getDailySalesSummary);

export default router;

