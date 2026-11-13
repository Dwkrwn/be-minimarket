import { Router } from "express";
import { managerOnly, requireRoles } from "../../core/middlewares/auth.js";
import { wrap } from "../../core/utils/helpers.js";
import { validateGuidParam } from "../../core/middlewares/auth.js";
import {
  listStocksService,
  getStockDetailService,
  listStockCardsService,
  createMutationService,
  listMutationsService,
  getMutationService,
  createAdjustmentService,
  listAdjustmentsService,
  getAdjustmentService,
  createOpnameService,
  updateOpnameService,
  submitOpnameService,
  approveOpnameService,
  rejectOpnameService,
  listOpnamesService,
  getOpnameService,
  listMinStockAlertsService,
  listExpiredAlertsService,
} from "./stock.service.js";

const router = Router();

router.get("/stocks", wrap(async (req, res) => {
  const result = await listStocksService(req.query);
  res.json({ status: "success", ...result });
}));

router.get("/stocks/:id", validateGuidParam("barang"), wrap(async (req, res) => {
  res.json({ status: "success", data: await getStockDetailService(req.params.id) });
}));

router.get("/cards", wrap(async (req, res) => {
  const result = await listStockCardsService(req.query);
  res.json({ status: "success", ...result });
}));

router.get("/mutations", wrap(async (req, res) => {
  const result = await listMutationsService(req.query);
  res.json({ status: "success", ...result });
}));

router.post("/mutations", managerOnly, wrap(async (req, res) => {
  res.status(201).json({ status: "success", data: await createMutationService(req.body, req.user.id) });
}));

router.get("/mutations/:id", validateGuidParam("mutasi"), wrap(async (req, res) => {
  res.json({ status: "success", data: await getMutationService(req.params.id) });
}));

router.get("/adjustments", wrap(async (req, res) => {
  const result = await listAdjustmentsService(req.query);
  res.json({ status: "success", ...result });
}));

router.post("/adjustments", managerOnly, wrap(async (req, res) => {
  res.status(201).json({ status: "success", data: await createAdjustmentService(req.body, req.user.id) });
}));

router.get("/adjustments/:id", validateGuidParam("penyesuaian"), wrap(async (req, res) => {
  res.json({ status: "success", data: await getAdjustmentService(req.params.id) });
}));

router.get("/opnames", wrap(async (req, res) => {
  const result = await listOpnamesService(req.query);
  res.json({ status: "success", ...result });
}));

router.post("/opnames", requireRoles("GUDANG", "ADMIN"), wrap(async (req, res) => {
  res.status(201).json({ status: "success", data: await createOpnameService(req.body, req.user.id) });
}));

router.get("/opnames/:id", validateGuidParam("opname"), wrap(async (req, res) => {
  res.json({ status: "success", data: await getOpnameService(req.params.id) });
}));

router.put("/opnames/:id", requireRoles("GUDANG", "ADMIN"), wrap(async (req, res) => {
  res.json({ status: "success", data: await updateOpnameService(req.params.id, req.body) });
}));

router.post("/opnames/:id/submit", requireRoles("GUDANG", "ADMIN"), wrap(async (req, res) => {
  res.json({ status: "success", data: await submitOpnameService(req.params.id) });
}));

router.post("/opnames/:id/approve", requireRoles("SUPER_ADMIN", "ADMIN"), wrap(async (req, res) => {
  res.json({ status: "success", data: await approveOpnameService(req.params.id, req.user.id) });
}));

router.post("/opnames/:id/reject", requireRoles("SUPER_ADMIN", "ADMIN"), wrap(async (req, res) => {
  res.json({ status: "success", data: await rejectOpnameService(req.params.id, req.body, req.user.id) });
}));

router.get("/alerts/min-stock", wrap(async (req, res) => {
  res.json({ status: "success", ...await listMinStockAlertsService(req.query) });
}));

router.get("/alerts/expired", wrap(async (req, res) => {
  res.json({ status: "success", ...await listExpiredAlertsService(req.query) });
}));

export default router;
