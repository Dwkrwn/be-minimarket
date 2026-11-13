import { wrap } from "../../core/utils/helpers.js";
import {
  listRolesService,
  getRoleByIdService,
  createRoleWithDetailsService,
  updateRoleWithDetailsService,
  deleteRoleService,
} from "./role.service.js";

export const listRoles = wrap(async (req, res) => {
  const result = await listRolesService(req.query);
  res.json({
    status: "success",
    data: result.data,
    pagination: result.pagination,
  });
});

export const getRoleById = wrap(async (req, res) => {
  const role = await getRoleByIdService(req.params.id);
  res.json({ status: "success", data: role });
});

export const createRoleWithDetails = wrap(async (req, res) => {
  const role = await createRoleWithDetailsService(req.body, req.user.id);
  res.status(201).json({ status: "success", data: role });
});

export const updateRoleWithDetails = wrap(async (req, res) => {
  const role = await updateRoleWithDetailsService(
    req.params.id,
    req.body,
    req.user.id,
  );
  res.status(200).json({ status: "success", data: role });
});

export const deleteRole = wrap(async (req, res) => {
  await deleteRoleService(req.params.id, req.user.id);
  res.json({ status: "success", message: "Role berhasil dihapus" });
});
