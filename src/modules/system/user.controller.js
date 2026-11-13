import { wrap } from "../../core/utils/helpers.js";
import {
  listUsersService,
  getUserByIdService,
  createUserService,
  updateUserService,
  deleteUserService,
} from "./user.service.js";

export const listUsers = wrap(async (req, res) => {
  const result = await listUsersService(req.query);
  res.json({
    status: "success",
    data: result.data,
    pagination: result.pagination,
  });
});

export const getUserById = wrap(async (req, res) => {
  const user = await getUserByIdService(req.params.id);
  res.json({ status: "success", data: user });
});

export const createUser = wrap(async (req, res) => {
  const user = await createUserService(req.body, req.user.id);
  res.status(201).json({ status: "success", data: user });
});

export const updateUser = wrap(async (req, res) => {
  const user = await updateUserService(req.params.id, req.body, req.user.id);
  res.status(200).json({ status: "success", data: user });
});

export const deleteUser = wrap(async (req, res) => {
  await deleteUserService(req.params.id, req.user.id);
  res.json({ status: "success", message: "User berhasil dihapus" });
});
