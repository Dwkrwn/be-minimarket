import { createHash } from "node:crypto";

export const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

export const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");

export const userInclude = {
  role: {
    include: {
      m_role_ds: {
        include: {
          m_menu: true,
        },
      },
    },
  },
};

export const ROLES = Object.freeze({
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  KASIR: "KASIR",
  GUDANG: "GUDANG",
});

export const isSuper = (user) => user?.role?.system_key === ROLES.SUPER_ADMIN;

export const isManager = (user) =>
  [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(user?.role?.system_key || "");

export const hasRole = (user, ...keys) =>
  isSuper(user) || keys.includes(user?.role?.system_key);

export function publicUser(user) {
  if (!user) return user;
  const { password_hash, sessions, ...safe } = user;
  return safe;
}
