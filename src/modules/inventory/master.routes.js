import { Router } from "express";
import { createCrudRouter } from "../../core/crud.js";
import { validateGuidParam, managerOnly } from "../../core/middlewares/auth.js";
import { wrap } from "../../core/utils/helpers.js";
import {
  categoryService,
  unitService,
  rackService,
  itemService,
  getItemByBarcodeService,
  getItemStockService,
} from "./master.service.js";

const router = Router();
const guard = { writeGuard: managerOnly };

router.use(
  "/categories",
  createCrudRouter(categoryService, validateGuidParam("kategori"), guard),
);
router.use("/units", createCrudRouter(unitService, validateGuidParam("satuan"), guard));
router.use("/racks", createCrudRouter(rackService, validateGuidParam("rak"), guard));

router.get(
  "/items/barcode/:barcode",
  wrap(async (req, res) => {
    res.json({
      status: "success",
      data: await getItemByBarcodeService(req.params.barcode),
    });
  }),
);

router.get(
  "/items/:id/stock",
  validateGuidParam("barang"),
  wrap(async (req, res) => {
    res.json({
      status: "success",
      data: await getItemStockService(req.params.id),
    });
  }),
);

router.use(
  "/items",
  createCrudRouter(itemService, validateGuidParam("barang"), guard),
);

export default router;
