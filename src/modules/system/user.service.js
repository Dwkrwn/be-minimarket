import bcrypt from "bcryptjs";
import prisma from "../../config/database.js";
import {
  fail,
  isSuper,
  isManager,
  publicUser,
  userInclude,
} from "../../core/utils/helpers.js";
import { securityTransaction } from "../../core/utils/securityTx.js";
import { validate } from "../../core/utils/validation.js";
import { userSchema } from "./system.validation.js";

export async function getActor(tx, userId) {
  const current = await tx.user_default.findUnique({
    where: { id: userId },
    include: userInclude,
  });
  if (!current?.is_active || !current.role.is_active || !isManager(current)) {
    fail(403, "Akses pengelola diperlukan");
  }
  return current;
}

export async function listUsersService(query) {
  const page = Number(query.page || 1);
  const limit = Number(query.paginate || 20);
  const order = query.order_by || "createdAt";
  const direction = String(query.order_type || "DESC").toLowerCase();
  const fields = ["name", "username"];

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
    prisma.user_default.count({ where }),
    prisma.user_default.findMany({
      where,
      include: { role: true },
      orderBy: [{ [order]: direction }, { id: "asc" }],
      ...(all ? {} : { skip: (page - 1) * limit, take: limit }),
    }),
  ]);

  return {
    data: rows.map(publicUser),
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

export async function getUserByIdService(id) {
  const data = await prisma.user_default.findUnique({
    where: { id },
    include: { role: true },
  });
  if (!data) fail(404, "Data tidak ditemukan");
  return publicUser(data);
}

export async function createUserService(body, currentUserId) {
  const value = validate(userSchema, body);
  if (!value.password) fail(400, "Password wajib diisi");
  const password_hash = await bcrypt.hash(value.password, 12);

  return securityTransaction(async (tx) => {
    const currentActor = await getActor(tx, currentUserId);
    const role = await tx.m_role.findUnique({ where: { id: value.role_id } });
    if (!role?.is_active) fail(400, "Pilih role aktif");

    if (!isSuper(currentActor) && role.system_key === "SUPER_ADMIN") {
      fail(403, "Admin tidak dapat mengelola Super Admin");
    }

    const { password: ignored, ...rest } = value;
    const payload = {
      ...rest,
      username: rest.username.toLowerCase(),
      password_hash,
    };

    const saved = await tx.user_default.create({
      data: payload,
      include: { role: true },
    });

    return publicUser(saved);
  });
}

export async function updateUserService(id, body, currentUserId) {
  const value = validate(userSchema, body);
  const password_hash = value.password
    ? await bcrypt.hash(value.password, 12)
    : undefined;

  return securityTransaction(async (tx) => {
    const currentActor = await getActor(tx, currentUserId);
    const role = await tx.m_role.findUnique({ where: { id: value.role_id } });
    if (!role?.is_active) fail(400, "Pilih role aktif");

    const existing = await tx.user_default.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!existing) fail(404, "User tidak ditemukan");

    if (
      !isSuper(currentActor) &&
      (role.system_key === "SUPER_ADMIN" ||
        existing.role.system_key === "SUPER_ADMIN")
    ) {
      fail(403, "Admin tidak dapat mengelola Super Admin");
    }

    if (
      existing.is_active &&
      existing.role.system_key === "SUPER_ADMIN" &&
      (!value.is_active || role.system_key !== "SUPER_ADMIN")
    ) {
      const activeSuperCount = await tx.user_default.count({
        where: { is_active: true, role: { system_key: "SUPER_ADMIN" } },
      });
      if (activeSuperCount <= 1) {
        fail(409, "Super Admin aktif terakhir harus dipertahankan");
      }
    }

    const { password: ignored, ...rest } = value;
    const payload = {
      ...rest,
      username: rest.username.toLowerCase(),
      ...(password_hash ? { password_hash } : {}),
    };

    const saved = await tx.user_default.update({
      where: { id },
      data: payload,
      include: { role: true },
    });

    if (password_hash || !value.is_active) {
      await tx.auth_session.deleteMany({ where: { user_id: saved.id } });
    }

    return publicUser(saved);
  });
}

export async function deleteUserService(id, currentUserId) {
  return securityTransaction(async (tx) => {
    const currentActor = await getActor(tx, currentUserId);
    const user = await tx.user_default.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!user) fail(404, "User tidak ditemukan");

    if (isSuper(user)) {
      if (!isSuper(currentActor)) {
        fail(403, "Admin tidak dapat mengelola Super Admin");
      }
      if (
        user.is_active &&
        (await tx.user_default.count({
          where: { is_active: true, role: { system_key: "SUPER_ADMIN" } },
        })) <= 1
      ) {
        fail(409, "Super Admin aktif terakhir harus dipertahankan");
      }
    }

    await tx.user_default.delete({ where: { id: user.id } });
  });
}
