import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import prisma from "../../config/database.js";
import {
  fail,
  hashToken,
  userInclude,
  publicUser,
  isSuper,
  isManager,
  ROLES,
} from "../../core/utils/helpers.js";
import { securityTransaction } from "../../core/utils/securityTx.js";

const attempts = new Map();
const dummyHash = bcrypt.hashSync("not-a-real-account-password", 12);

export async function loginService({ username, password, clientIp }) {
  const now = Date.now();
  for (const [ip, value] of attempts) {
    if (value.until <= now) attempts.delete(ip);
  }

  const entry = attempts.get(clientIp) || {
    count: 0,
    until: now + 15 * 60 * 1000,
  };

  if (entry.count >= 10) {
    const retryAfter = Math.ceil((entry.until - now) / 1000);
    const err = new Error("Terlalu banyak percobaan login. Coba lagi nanti.");
    err.status = 429;
    err.retryAfter = retryAfter;
    throw err;
  }

  entry.count++;
  attempts.set(clientIp, entry);

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    password.length > 72
  ) {
    fail(401, "Username atau password salah");
  }

  const user = await prisma.user_default.findUnique({
    where: { username: username.trim().toLowerCase() },
    include: userInclude,
  });

  let valid = false;
  if (user?.password_hash) {
    if (
      user.password_hash.startsWith("$2a$") ||
      user.password_hash.startsWith("$2b$")
    ) {
      valid = await bcrypt.compare(password, user.password_hash);
    } else {
      valid = user.password_hash === password;
      if (valid) {
        const hashed = await bcrypt.hash(password, 12);
        await prisma.user_default.update({
          where: { id: user.id },
          data: { password_hash: hashed },
        });
      }
    }
  } else {
    await bcrypt.compare(password, dummyHash);
  }

  if (!valid || !user?.is_active || !user.role?.is_active) {
    fail(401, "Username atau password salah");
  }

  attempts.delete(clientIp);

  const token = randomBytes(32).toString("hex");
  await prisma.auth_session.deleteMany({
    where: { expires_at: { lte: new Date() } },
  });

  await prisma.auth_session.create({
    data: {
      token_hash: hashToken(token),
      user_id: user.id,
      expires_at: new Date(now + 8 * 60 * 60 * 1000),
    },
  });

  const profileData = await getProfileService(user);
  return { token, user: profileData };
}

export async function logoutService(sessionId) {
  if (sessionId) {
    await prisma.auth_session.deleteMany({ where: { id: sessionId } });
  }
}

export async function getProfileService(user) {
  const menus = await prisma.m_menu.findMany({ where: { is_active: true } });
  const permissions = {};
  const allowed = [];

  for (const menu of menus) {
    if (!menu.path?.trim()) continue;
    const path = "/" + menu.path.trim().replace(/^\/+/, "");
    const systemMenu = [
      "/setup/menu",
      "/setup/user_default",
      "/setup/m_role",
    ].includes(path);

    let permission = user.role?.m_role_ds?.find((p) => p.m_menu_id === menu.id);
    if (
      isSuper(user) ||
      (isManager(user) &&
        ["/setup/user_default", "/setup/m_role"].includes(path))
    ) {
      permission = {
        is_read: true,
        is_create: true,
        is_update: true,
        is_delete: true,
        is_print: true,
      };
    } else if (systemMenu) {
      continue;
    }

    if (permission?.is_read) {
      allowed.push({ ...menu, path });
      permissions[menu.id] = Object.fromEntries(
        ["read", "create", "update", "delete", "print"].map((action) => [
          `is_${action}`,
          !!permission[`is_${action}`],
        ]),
      );
    }
  }

  return { ...publicUser(user), menus: allowed, permissions };
}

export async function bootstrap({ username, name, password }) {
  if (
    !/^[a-zA-Z0-9_.-]{1,100}$/.test(username) ||
    !name?.trim() ||
    name.length > 100 ||
    typeof password !== "string" ||
    password.length < 8 ||
    Buffer.byteLength(password) > 72
  ) {
    fail(400, "Nama/username tidak valid atau password harus 8–72 byte");
  }

  const password_hash = await bcrypt.hash(password, 12);
  return securityTransaction(async (tx) => {
    const superRole = await tx.m_role.upsert({
      where: { system_key: ROLES.SUPER_ADMIN },
      update: {},
      create: { nama_role: "Super Admin", system_key: ROLES.SUPER_ADMIN },
    });
    await tx.m_role.upsert({
      where: { system_key: ROLES.ADMIN },
      update: {},
      create: { nama_role: "Admin", system_key: ROLES.ADMIN },
    });
    for (const [systemKey, namaRole] of [
      [ROLES.KASIR, "Kasir"],
      [ROLES.GUDANG, "Gudang"],
    ]) {
      await tx.m_role.upsert({
        where: { system_key: systemKey },
        update: {},
        create: { nama_role: namaRole, system_key: systemKey },
      });
    }
    if (!(await tx.m_role.findUnique({ where: { nama_role: "Karyawan" } }))) {
      await tx.m_role.create({ data: { nama_role: "Karyawan" } });
    }

    for (const [name, path, seq, icon] of [
      ["Menu", "/setup/menu", "1.1", "Menu"],
      ["User", "/setup/user_default", "1.2", "Users"],
      ["Role", "/setup/m_role", "1.3", "Shield"],
    ]) {
      if (!(await tx.m_menu.findFirst({ where: { path } }))) {
        await tx.m_menu.create({
          data: { name, path, seq, icon, modul: "SETUP", is_active: true },
        });
      }
    }

    if (await tx.user_default.count()) return { created: false };
    const user = await tx.user_default.create({
      data: {
        username: username.toLowerCase(),
        name: name.trim(),
        password_hash,
        role_id: superRole.id,
      },
    });
    return { created: true, id: user.id };
  });
}
