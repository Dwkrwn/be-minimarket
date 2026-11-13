import { Router } from "express";
import { login, getMe, logout, getMenuOptions } from "./auth.controller.js";
import { authenticate, managerOnly } from "../../core/middlewares/auth.js";

const router = Router();

router.post("/login", login);
router.get("/me", authenticate, getMe);
router.post("/logout", authenticate, logout);
router.get("/menu-options", authenticate, managerOnly, getMenuOptions);

export default router;
