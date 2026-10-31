import { createHash } from 'node:crypto';
import prisma from './config/database.js';

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const userInclude = { role: { include: { m_role_ds: { include: { m_menu: true } } } } };
export const isSuper = (user) => user.role.system_key === 'SUPER_ADMIN';
export const isManager = (user) => ['SUPER_ADMIN', 'ADMIN'].includes(user.role.system_key);
export function publicUser(user) {
  const { password_hash, sessions, ...safe } = user;
  return safe;
}
export const authenticate = wrap(async (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) fail(401, 'Sesi tidak valid, silakan login');
  const session = await prisma.auth_session.findUnique({ where: { token_hash: hashToken(token) }, include: { user: { include: userInclude } } });
  if (!session || session.expires_at <= new Date() || !session.user.is_active || !session.user.role.is_active) fail(401, 'Sesi berakhir, silakan login');
  req.user = session.user;
  req.session = session;
  next();
});
export const managerOnly = (req, res, next) => {
  if (!isManager(req.user)) return res.status(403).json({ status: 'error', message: 'Hanya Admin yang dapat mengelola akun dan role' });
  next();
};
export const superOnly = (req, res, next) => {
  if (!isSuper(req.user)) return res.status(403).json({ status: 'error', message: 'Hanya Super Admin yang dapat mengelola menu' });
  next();
};
export async function profile(user) {
  const menus = await prisma.m_menu.findMany({ where: { is_active: true } });
  const permissions = {};
  const allowed = [];
  for (const menu of menus) {
    if (!menu.path?.trim()) continue;
    const path = '/' + menu.path.trim().replace(/^\/+/, '');
    const systemMenu = ['/setup/menu', '/setup/user_default', '/setup/m_role'].includes(path);
    let permission = user.role.m_role_ds.find((p) => p.m_menu_id === menu.id);
    if (isSuper(user) || (isManager(user) && ['/setup/user_default', '/setup/m_role'].includes(path))) {
      permission = { is_read: true, is_create: true, is_update: true, is_delete: true, is_print: true };
    } else if (systemMenu) continue;
    if (permission?.is_read) {
      allowed.push({ ...menu, path });
      permissions[menu.id] = Object.fromEntries(['read', 'create', 'update', 'delete', 'print'].map((action) => [`is_${action}`, !!permission[`is_${action}`]]));
    }
  }
  return { ...publicUser(user), menus: allowed, permissions };
}
// Serialize changes to security principals, including the final Super Admin check.
export const securityTransaction = (fn) => prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(827341)`;
  return fn(tx);
}, { timeout: 15000 });
