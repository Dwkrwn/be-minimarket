import { Router } from "express";
import authRoutes from "./auth/auth.routes.js";
import userRoutes from "./system/user.routes.js";
import roleRoutes from "./system/role.routes.js";
import menuRoutes from "./system/menu.routes.js";

// Modular Clean Architecture Routers (server/modules/*)
import inventoryRoutes from "../../server/modules/inventory/inventory.routes.js";
import purchasingRoutes from "../../server/modules/purchasing/purchasing.routes.js";
import posRoutes from "../../server/modules/pos/pos.routes.js";

import { authenticate, managerOnly, superOnly } from "../core/middlewares/auth.js";

const router = Router();

// Autentikasi & RBAC
router.use("/auth", authRoutes);
router.use("/dynamic/user_default", authenticate, managerOnly, userRoutes);
router.use("/dynamic/m_role", authenticate, managerOnly, roleRoutes);
router.use("/dynamic/m_menu", authenticate, superOnly, menuRoutes);
router.use("/api/dynamic/m_menu", authenticate, superOnly, menuRoutes);

// Modul Bisnis Sistem Minimarket Terintegrasi (Mendukung prefix dengan atau tanpa /api)
router.use("/api/v1/inventory", inventoryRoutes);
router.use("/v1/inventory", inventoryRoutes);
router.use("/api/v1/purchasing", purchasingRoutes);
router.use("/v1/purchasing", purchasingRoutes);
router.use("/api/v1/pos", posRoutes);
router.use("/v1/pos", posRoutes);

export default router;
