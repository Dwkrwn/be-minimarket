import prisma from "../../config/database.js";
import { fail } from "../../core/utils/helpers.js";
import { securityTransaction } from "../../core/utils/securityTx.js";
import { validate } from "../../core/utils/validation.js";
import { roleSchema } from "./system.validation.js";
import { getActor } from "./user.service.js";

export async function listRolesService(query) {
  const page = Number(query.page || 1);
  const limit = Number(query.paginate || 20);
  const order = query.order_by || "createdAt";
  const direction = String(query.order_type || "DESC").toLowerCase();
  const fields = ["nama_role", "kode_role"];

  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    ![...fields, "createdAt", "updatedAt", "is_active"].includes(order) ||
    !["asc", "desc"].includes(direction)
  ) {
    fail(400, "Parameter daftar tidak valid");
  }

  const search = String(query.search || "").trim();
  const where = search
    ? {
        OR: fields.map((field) => ({
          [field]: { contains: search, mode: "insensitive" },
        })),
      }
    : {};

  const all = query.no_pagination === "true";
  const [total, rows] = await prisma.$transaction([
    prisma.m_role.count({ where }),
    prisma.m_role.findMany({
      where,
      orderBy: [{ [order]: direction }, { id: "asc" }],
      ...(all ? {} : { skip: (page - 1) * limit, take: limit }),
    }),
  ]);

  return {
    data: rows,
    pagination: {
      total,
      page: all ? 1 : page,
      limit: all ? total : limit,
      totalPages: all ? 1 : Math.ceil(total / limit),
      currentRowsCount: rows.length,
      next_page: !all && page * limit < total ? page + 1 : null,
      prev_page: !all && page > 1 ? page - 1 : null,
    },
  };
}

export async function getRoleByIdService(id) {
  const data = await prisma.m_role.findUnique({
    where: { id },
    include: { m_role_ds: { include: { m_menu: true } } },
  });
  if (!data) fail(404, "Data tidak ditemukan");
  return data;
}

export async function createRoleWithDetailsService(body, currentUserId) {
  const { m_role_d, ...value } = validate(roleSchema, body);

  return securityTransaction(async (tx) => {
    await getActor(tx, currentUserId);

    const menuIds = m_role_d.map((p) => p.m_menu_id);
    const menus = await tx.m_menu.findMany({
      where: { id: { in: menuIds } },
    });
    if (menus.length !== menuIds.length) fail(400, "Menu tidak ditemukan");

    if (
      menus.some((m) =>
        ["/setup/menu", "/setup/user_default", "/setup/m_role"].includes(m.path),
      )
    ) {
      fail(400, "Menu pengelolaan sistem hanya untuk role sistem");
    }

    if (
      m_role_d.some(
        (p) =>
          !p.is_read &&
          (p.is_create || p.is_update || p.is_delete || p.is_print),
      )
    ) {
      fail(400, "Izin aksi memerlukan izin lihat");
    }

    const saved = await tx.m_role.create({
      data: { ...value, m_role_ds: { create: m_role_d } },
      include: { m_role_ds: true },
    });

    return saved;
  });
}

export async function updateRoleWithDetailsService(id, body, currentUserId) {
  const { m_role_d, ...value } = validate(roleSchema, body);

  return securityTransaction(async (tx) => {
    await getActor(tx, currentUserId);

    const old = await tx.m_role.findUnique({ where: { id } });
    if (!old) fail(404, "Role tidak ditemukan");
    if (old.system_key) {
      fail(409, "Role sistem tidak dapat diubah; buat role baru untuk izin khusus");
    }

    const menuIds = m_role_d.map((p) => p.m_menu_id);
    const menus = await tx.m_menu.findMany({
      where: { id: { in: menuIds } },
    });
    if (menus.length !== menuIds.length) fail(400, "Menu tidak ditemukan");

    if (
      menus.some((m) =>
        ["/setup/menu", "/setup/user_default", "/setup/m_role"].includes(m.path),
      )
    ) {
      fail(400, "Menu pengelolaan sistem hanya untuk role sistem");
    }

    if (
      m_role_d.some(
        (p) =>
          !p.is_read &&
          (p.is_create || p.is_update || p.is_delete || p.is_print),
      )
    ) {
      fail(400, "Izin aksi memerlukan izin lihat");
    }

    const saved = await tx.m_role.update({
      where: { id },
      data: {
        ...value,
        m_role_ds: { deleteMany: {}, create: m_role_d },
      },
      include: { m_role_ds: true },
    });

    if (!value.is_active) {
      await tx.auth_session.deleteMany({
        where: { user: { role_id: saved.id } },
      });
    }

    return saved;
  });
}

export async function deleteRoleService(id, currentUserId) {
  return securityTransaction(async (tx) => {
    await getActor(tx, currentUserId);
    const role = await tx.m_role.findUnique({ where: { id } });
    if (!role) fail(404, "Role tidak ditemukan");
    if (role.system_key) fail(409, "Role sistem tidak dapat dihapus");

    if (await tx.user_default.count({ where: { role_id: role.id } })) {
      fail(409, "Role masih digunakan oleh akun");
    }

    await tx.m_role.delete({ where: { id: role.id } });
  });
}
