import { Router } from "express";
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser,
} from "./user.controller.js";
import { validateGuidParam } from "../../core/middlewares/auth.js";

const router = Router();

router.param("id", validateGuidParam("user"));

router.get("/", listUsers);
router.get("/:id", getUserById);
router.post("/", createUser);
router.post("/:id/reset-password", resetUserPassword);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);

export default router;
