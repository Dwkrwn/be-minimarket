import { wrap } from "../../core/utils/helpers.js";
import {
  getSettingsMap,
  listSettingsService,
  saveSettingsService,
  listProductsService,
  listShiftsService,
  getShiftService,
  getShiftSummaryService,
  openShiftService,
  closeShiftService,
  checkoutService,
  listOrdersService,
  getOrderService,
  getReceiptService,
  voidOrderService,
  createHoldService,
  listHoldsService,
  takeHoldService,
  deleteHoldService,
  listPosReturnsService,
  getPosReturnService,
  createPosReturnService,
  approvePosReturnService,
  rejectPosReturnService,
  salesReportService,
  shiftSalesReportService,
} from "./pos.service.js";

export const settings = wrap(async (req, res) => {
  res.json({ status: "success", ...(await listSettingsService()) });
});

export const settingsPublic = wrap(async (req, res) => {
  res.json({ status: "success", data: await getSettingsMap() });
});

export const saveSettings = wrap(async (req, res) => {
  res.json({ status: "success", data: await saveSettingsService(req.body) });
});

export const products = wrap(async (req, res) => {
  const result = await listProductsService(req.query);
  res.json({ status: "success", data: result.data, pagination: result.pagination });
});

export const listShifts = wrap(async (req, res) => {
  const result = await listShiftsService(req.query);
  res.json({ status: "success", data: result.data, pagination: result.pagination });
});

export const getShift = wrap(async (req, res) => {
  res.json({ status: "success", data: await getShiftService(req.params.id) });
});

export const getShiftSummary = wrap(async (req, res) => {
  res.json({ status: "success", data: await getShiftSummaryService(req.params.id) });
});

export const openShift = wrap(async (req, res) => {
  res.status(201).json({
    status: "success",
    data: await openShiftService(req.body, req.user.id),
  });
});

export const closeShift = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await closeShiftService(req.params.id, req.body, req.user),
  });
});

export const checkout = wrap(async (req, res) => {
  res.status(201).json({
    status: "success",
    data: await checkoutService(req.body, req.user.id),
  });
});

export const listOrders = wrap(async (req, res) => {
  const result = await listOrdersService(req.query);
  res.json({ status: "success", data: result.data, pagination: result.pagination });
});

export const getOrder = wrap(async (req, res) => {
  res.json({ status: "success", data: await getOrderService(req.params.id) });
});

export const getReceipt = wrap(async (req, res) => {
  res.json({ status: "success", data: await getReceiptService(req.params.id) });
});

export const voidOrder = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await voidOrderService(req.params.id, req.body, req.user.id),
  });
});

export const createHold = wrap(async (req, res) => {
  res.status(201).json({
    status: "success",
    data: await createHoldService(req.body, req.user.id),
  });
});

export const listHolds = wrap(async (req, res) => {
  const result = await listHoldsService(req.query);
  res.json({ status: "success", data: result.data, pagination: result.pagination });
});

export const takeHold = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await takeHoldService(req.params.id, req.user.id),
  });
});

export const deleteHold = wrap(async (req, res) => {
  await deleteHoldService(req.params.id);
  res.json({ status: "success", message: "Hold berhasil dihapus" });
});

export const listPosReturns = wrap(async (req, res) => {
  const result = await listPosReturnsService(req.query);
  res.json({ status: "success", data: result.data, pagination: result.pagination });
});

export const getPosReturn = wrap(async (req, res) => {
  res.json({ status: "success", data: await getPosReturnService(req.params.id) });
});

export const createPosReturn = wrap(async (req, res) => {
  res.status(201).json({
    status: "success",
    data: await createPosReturnService(req.body, req.user.id),
  });
});

export const approvePosReturn = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await approvePosReturnService(req.params.id, req.user.id),
  });
});

export const rejectPosReturn = wrap(async (req, res) => {
  res.json({
    status: "success",
    data: await rejectPosReturnService(req.params.id, req.body, req.user.id),
  });
});

export const salesReport = wrap(async (req, res) => {
  res.json({ status: "success", data: await salesReportService(req.query) });
});

export const shiftSalesReport = wrap(async (req, res) => {
  res.json({ status: "success", data: await shiftSalesReportService(req.params.id) });
});
