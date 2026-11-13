import { Router } from "express";
import {
  authenticate,
  requireRoles,
  validateGuidParam,
} from "../../core/middlewares/auth.js";
import { createCrudRouter } from "../../core/crud.js";
import {
  supplierService,
  supplierPriceService,
} from "./purchasing.service.js";
import {
  getSupplierPrices,
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
  orderPurchaseOrder,
  cancelPurchaseOrder,
  listGoodsReceipts,
  getGoodsReceipt,
  createGoodsReceipt,
  listPurchaseReturns,
  getPurchaseReturn,
  createPurchaseReturn,
  completePurchaseReturn,
  cancelPurchaseReturn,
  listPurchaseInvoices,
  getPurchaseInvoice,
  createPurchaseInvoice,
  updatePurchaseInvoiceStatus,
  listPayables,
  listPurchaseRecommendations,
} from "./purchasing.controller.js";

const router = Router();
router.use(authenticate);

const adminOnly = requireRoles("ADMIN");
const purchasingRoles = requireRoles("ADMIN", "GUDANG");

/* ---------- Supplier ---------- */
router.use(
  "/suppliers",
  createCrudRouter(supplierService, validateGuidParam("supplier"), {
    writeGuard: adminOnly,
  }),
);
router.get(
  "/suppliers/:id/prices",
  validateGuidParam("supplier"),
  getSupplierPrices,
);

/* ---------- Harga supplier ---------- */
router.use(
  "/supplier-prices",
  createCrudRouter(
    supplierPriceService,
    validateGuidParam("harga supplier"),
    { writeGuard: adminOnly },
  ),
);

/* ---------- Purchase order ---------- */
router.get("/purchase-orders", listPurchaseOrders);
router.get(
  "/purchase-orders/:id",
  validateGuidParam("purchase order"),
  getPurchaseOrder,
);
router.post("/purchase-orders", purchasingRoles, createPurchaseOrder);
router.put(
  "/purchase-orders/:id",
  validateGuidParam("purchase order"),
  purchasingRoles,
  updatePurchaseOrder,
);
router.post(
  "/purchase-orders/:id/order",
  validateGuidParam("purchase order"),
  purchasingRoles,
  orderPurchaseOrder,
);
router.post(
  "/purchase-orders/:id/cancel",
  validateGuidParam("purchase order"),
  purchasingRoles,
  cancelPurchaseOrder,
);

/* ---------- Penerimaan barang ---------- */
router.get("/goods-receipts", listGoodsReceipts);
router.get(
  "/goods-receipts/:id",
  validateGuidParam("penerimaan"),
  getGoodsReceipt,
);
router.post("/goods-receipts", purchasingRoles, createGoodsReceipt);

/* ---------- Retur pembelian ---------- */
router.get("/purchase-returns", listPurchaseReturns);
router.get(
  "/purchase-returns/:id",
  validateGuidParam("retur pembelian"),
  getPurchaseReturn,
);
router.post("/purchase-returns", purchasingRoles, createPurchaseReturn);
router.post(
  "/purchase-returns/:id/complete",
  validateGuidParam("retur pembelian"),
  purchasingRoles,
  completePurchaseReturn,
);
router.post(
  "/purchase-returns/:id/cancel",
  validateGuidParam("retur pembelian"),
  purchasingRoles,
  cancelPurchaseReturn,
);

/* ---------- Invoice & hutang ---------- */
router.get("/purchase-invoices", listPurchaseInvoices);
router.get(
  "/purchase-invoices/:id",
  validateGuidParam("invoice"),
  getPurchaseInvoice,
);
router.post("/purchase-invoices", adminOnly, createPurchaseInvoice);
router.patch(
  "/purchase-invoices/:id/status",
  validateGuidParam("invoice"),
  adminOnly,
  updatePurchaseInvoiceStatus,
);
router.get("/payables", listPayables);

/* ---------- Rekomendasi belanja ---------- */
router.get("/purchase-recommendations", listPurchaseRecommendations);

export default router;
