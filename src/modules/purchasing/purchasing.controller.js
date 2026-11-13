import { wrap } from "../../core/utils/helpers.js";
import {
  getSupplierPricesService,
  listPurchaseOrdersService,
  getPurchaseOrderService,
  createPurchaseOrderService,
  updatePurchaseOrderService,
  setPurchaseOrderStatusService,
  listGoodsReceiptsService,
  getGoodsReceiptService,
  createGoodsReceiptService,
  listPurchaseReturnsService,
  getPurchaseReturnService,
  createPurchaseReturnService,
  completePurchaseReturnService,
  cancelPurchaseReturnService,
  listPurchaseInvoicesService,
  getPurchaseInvoiceService,
  createPurchaseInvoiceService,
  updatePurchaseInvoiceStatusService,
  listPayablesService,
  listPurchaseRecommendationsService,
} from "./purchasing.service.js";

export const getSupplierPrices = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await getSupplierPricesService(req.params.id),
  });
});

export const listPurchaseOrders = wrap(async (req, res) => {
  const result = await listPurchaseOrdersService(req.query);
  res.json({ status: "success", data: result.data, pagination: result.pagination });
});

export const getPurchaseOrder = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await getPurchaseOrderService(req.params.id),
  });
});

export const createPurchaseOrder = wrap(async (req, res) => {
  res.status(201).json({
    status: "success",
    data: await createPurchaseOrderService(req.body, req.user.id),
  });
});

export const updatePurchaseOrder = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await updatePurchaseOrderService(req.params.id, req.body),
  });
});

export const orderPurchaseOrder = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await setPurchaseOrderStatusService(req.params.id, "ORDERED"),
  });
});

export const cancelPurchaseOrder = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await setPurchaseOrderStatusService(req.params.id, "CANCELLED"),
  });
});

export const listGoodsReceipts = wrap(async (req, res) => {
  const result = await listGoodsReceiptsService(req.query);
  res.json({ status: "success", data: result.data, pagination: result.pagination });
});

export const getGoodsReceipt = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await getGoodsReceiptService(req.params.id),
  });
});

export const createGoodsReceipt = wrap(async (req, res) => {
  res.status(201).json({
    status: "success",
    data: await createGoodsReceiptService(req.body, req.user.id),
  });
});

export const listPurchaseReturns = wrap(async (req, res) => {
  const result = await listPurchaseReturnsService(req.query);
  res.json({ status: "success", data: result.data, pagination: result.pagination });
});

export const getPurchaseReturn = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await getPurchaseReturnService(req.params.id),
  });
});

export const createPurchaseReturn = wrap(async (req, res) => {
  res.status(201).json({
    status: "success",
    data: await createPurchaseReturnService(req.body, req.user.id),
  });
});

export const completePurchaseReturn = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await completePurchaseReturnService(req.params.id, req.user.id),
  });
});

export const cancelPurchaseReturn = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await cancelPurchaseReturnService(req.params.id),
  });
});

export const listPurchaseInvoices = wrap(async (req, res) => {
  const result = await listPurchaseInvoicesService(req.query);
  res.json({ status: "success", data: result.data, pagination: result.pagination });
});

export const getPurchaseInvoice = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await getPurchaseInvoiceService(req.params.id),
  });
});

export const createPurchaseInvoice = wrap(async (req, res) => {
  res.status(201).json({
    status: "success",
    data: await createPurchaseInvoiceService(req.body, req.user.id),
  });
});

export const updatePurchaseInvoiceStatus = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await updatePurchaseInvoiceStatusService(req.params.id, req.body),
  });
});

export const listPayables = wrap(async (req, res) => {
  const result = await listPayablesService(req.query);
  res.json({ status: "success", ...result });
});

export const listPurchaseRecommendations = wrap(async (req, res) => {
  res.json({
    status: "success",
    ...(await listPurchaseRecommendationsService(req.query)),
  });
});
