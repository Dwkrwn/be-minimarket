import { Router } from "express";
import {
  listMenus,
  getMenuById,
  createMenu,
  updateMenu,
  deleteMenu,
} from "./menu.controller.js";
import { validateGuidParam } from "../../core/middlewares/auth.js";

const router = Router();

router.param("id", validateGuidParam("menu"));

router.get("/", listMenus);
router.get("/:id", getMenuById);
router.post("/", createMenu);
router.put("/:id", updateMenu);
router.delete("/:id", deleteMenu);

export default router;
