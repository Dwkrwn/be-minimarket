import { Router } from "express";
import {
  listRoles,
  getRoleById,
  createRoleWithDetails,
  updateRoleWithDetails,
  deleteRole,
} from "./role.controller.js";
import { validateGuidParam } from "../../core/middlewares/auth.js";

const router = Router();

router.param("id", validateGuidParam("role"));

router.get("/", listRoles);
router.get("/:id", getRoleById);
router.post("/with-details", createRoleWithDetails);
router.put("/with-details/:id", updateRoleWithDetails);
router.delete("/:id", deleteRole);

export default router;
