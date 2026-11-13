import prisma from "../../config/database.js";
import { validate } from "../../core/utils/validation.js";
import { fail } from "../../core/utils/helpers.js";
import { menuSchema } from "./system.validation.js";

const fields = ["name", "modul", "sub_modul", "path", "seq", "desc", "icon"];

export async function listMenusService(query) {
  const page = Number(query.page || 1);
  const limit = Number(query.paginate || 10);
  const order =
    query.order_by_raw === "seq ASC"
      ? "seq"
      : query.order_by || "createdAt";
  const direction =
    query.order_by_raw === "seq ASC"
      ? "ASC"
      : query.order_type || "DESC";

  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    ![...fields, "createdAt", "updatedAt", "is_active"].includes(order) ||
    !["ASC", "DESC"].includes(direction)
  ) {
    fail(400, "Parameter daftar menu tidak valid");
  }

  const search = String(query.search || "").trim();
  const searchFields = String(
    query.searchfield || "name,modul,sub_modul,path",
  ).split(",");

  if (searchFields.some((field) => !fields.includes(field))) {
    fail(400, "Field pencarian tidak valid");
  }

  const where = search
    ? {
        OR: searchFields.map((field) => ({
          [field]: { contains: search, mode: "insensitive" },
        })),
      }
    : {};

  const rows = await prisma.m_menu.findMany({
    where,
    orderBy: [{ [order]: direction.toLowerCase() }, { id: "asc" }],
  });

  if (order === "seq") {
    rows.sort(
      (a, b) =>
        (a.seq.localeCompare(b.seq, undefined, { numeric: true }) ||
          a.id.localeCompare(b.id)) * (direction === "ASC" ? 1 : -1),
    );
  }

  const total = rows.length;
  const all = query.no_pagination === "true";
  const data = all ? rows : rows.slice((page - 1) * limit, page * limit);

  return {
    data,
    pagination: {
      total,
      page: all ? 1 : page,
      limit: all ? total : limit,
      totalPages: all ? 1 : Math.ceil(total / limit),
      currentRowsCount: data.length,
      next_page: !all && page * limit < total ? page + 1 : null,
      prev_page: !all && page > 1 ? page - 1 : null,
    },
  };
}

export async function getMenuByIdService(id) {
  const data = await prisma.m_menu.findUnique({ where: { id } });
  if (!data) fail(404, "Menu tidak ditemukan");
  return data;
}

export async function createMenuService(body) {
  const value = validate(menuSchema, body);
  const data = { ...value, seq: value.seq || "0" };
  return prisma.m_menu.create({ data });
}

export async function updateMenuService(id, body) {
  const value = validate(menuSchema, body);
  const data = { ...value, seq: value.seq || "0" };
  return prisma.m_menu.update({ where: { id }, data });
}

export async function deleteMenuService(id) {
  return prisma.m_menu.delete({ where: { id } });
}

export async function getMenuOptionsService(search = "") {
  const keyword = String(search || "").trim();
  const data = await prisma.m_menu.findMany({
    where: {
      is_active: true,
      NOT: {
        path: { in: ["/setup/menu", "/setup/user_default", "/setup/m_role"] },
      },
      ...(keyword
        ? {
            OR: ["name", "modul", "sub_modul", "path"].map((field) => ({
              [field]: { contains: keyword, mode: "insensitive" },
            })),
          }
        : {}),
    },
    orderBy: { seq: "asc" },
  });
  return data;
}
