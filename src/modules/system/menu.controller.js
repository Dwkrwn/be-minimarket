import { wrap } from "../../core/utils/helpers.js";
import {
  listMenusService,
  getMenuByIdService,
  createMenuService,
  updateMenuService,
  deleteMenuService,
} from "./menu.service.js";

export const listMenus = wrap(async (req, res) => {
  const result = await listMenusService(req.query);
  res.json({
    status: "success",
    data: result.data,
    pagination: result.pagination,
  });
});

export const getMenuById = wrap(async (req, res) => {
  const menu = await getMenuByIdService(req.params.id);
  res.json({ status: "success", data: menu });
});

export const createMenu = wrap(async (req, res) => {
  const menu = await createMenuService(req.body);
  res.status(201).json({ status: "success", data: menu });
});

export const updateMenu = wrap(async (req, res) => {
  const menu = await updateMenuService(req.params.id, req.body);
  res.status(200).json({ status: "success", data: menu });
});

export const deleteMenu = wrap(async (req, res) => {
  await deleteMenuService(req.params.id);
  res.json({ status: "success", message: "Menu berhasil dihapus" });
});
