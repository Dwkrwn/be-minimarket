import { Router } from 'express';
import Joi from 'joi';
import bcrypt from 'bcryptjs';
import prisma from '../config/database.js';
import { wrap, fail, isSuper, isManager, publicUser, userInclude, securityTransaction } from '../security.js';

export const users = Router();
export const roles = Router();
const str = Joi.string().trim().max(100);
const password = Joi.string().min(8).max(72).custom((value, helpers) => Buffer.byteLength(value) > 72 ? helpers.error('string.max', { limit: 72 }) : value);
const userSchema = Joi.object({ name: str.required(), username: str.pattern(/^[a-zA-Z0-9_.-]+$/).required(),
  password, role_id: Joi.string().guid().required(), is_active: Joi.boolean().strict().required(), catatan: Joi.string().allow('', null) });
const permissionSchema = Joi.object({ m_menu_id: Joi.string().guid().required(),
  ...Object.fromEntries(['read', 'create', 'update', 'delete', 'print'].map((action) => [`is_${action}`, Joi.boolean().strict().default(false)])) });
const roleSchema = Joi.object({ nama_role: str.required(), kode_role: str.allow('', null), catatan: Joi.string().allow('', null),
  is_active: Joi.boolean().strict().required(), m_role_d: Joi.array().items(permissionSchema).unique('m_menu_id').default([]) });
const validate = (schema, body) => {
  const { error, value } = schema.required().validate(body);
  if (error) fail(400, error.details[0].message);
  return value;
};
for (const router of [users, roles]) router.param('id', (req, res, next, id) => {
  if (Joi.string().guid().validate(id).error) return res.status(400).json({ status: 'error', message: 'ID tidak valid' });
  next();
});
async function actor(tx, req) {
  const current = await tx.user_default.findUnique({ where: { id: req.user.id }, include: userInclude });
  if (!current?.is_active || !current.role.is_active || !isManager(current)) fail(403, 'Akses pengelola diperlukan');
  return current;
}
async function list(req, res, model, fields, include) {
  const page = Number(req.query.page || 1), limit = Number(req.query.paginate || 20);
  const order = req.query.order_by || 'createdAt';
  const direction = String(req.query.order_type || 'DESC').toLowerCase();
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || ![...fields, 'createdAt', 'updatedAt', 'is_active'].includes(order) || !['asc', 'desc'].includes(direction)) fail(400, 'Parameter daftar tidak valid');
  const search = String(req.query.search || '').trim();
  const where = search ? { OR: fields.map((field) => ({ [field]: { contains: search, mode: 'insensitive' } })) } : {};
  const all = req.query.no_pagination === 'true';
  const [total, rows] = await prisma.$transaction([
    prisma[model].count({ where }),
    prisma[model].findMany({ where, include, orderBy: [{ [order]: direction }, { id: 'asc' }], ...(all ? {} : { skip: (page - 1) * limit, take: limit }) }),
  ]);
  res.json({ status: 'success', data: rows.map(publicUser), pagination: { total, page: all ? 1 : page, limit: all ? total : limit,
    totalPages: all ? 1 : Math.ceil(total / limit), currentRowsCount: rows.length, next_page: !all && page * limit < total ? page + 1 : null, prev_page: !all && page > 1 ? page - 1 : null } });
}
users.get('/', wrap((req, res) => list(req, res, 'user_default', ['name', 'username'], { role: true })));
roles.get('/', wrap((req, res) => list(req, res, 'm_role', ['nama_role', 'kode_role'], undefined)));
for (const [router, model, include] of [[users, 'user_default', { role: true }], [roles, 'm_role', { m_role_ds: { include: { m_menu: true } } }]]) {
  router.get('/:id', wrap(async (req, res) => {
    const data = await prisma[model].findUnique({ where: { id: req.params.id }, include });
    if (!data) fail(404, 'Data tidak ditemukan');
    res.json({ status: 'success', data: publicUser(data) });
  }));
}
for (const method of ['post', 'put']) {
  users[method](method === 'post' ? '/' : '/:id', wrap(async (req, res) => {
    const value = validate(userSchema, req.body);
    if (method === 'post' && !value.password) fail(400, 'Password wajib diisi');
    const password_hash = value.password ? await bcrypt.hash(value.password, 12) : undefined;
    const data = await securityTransaction(async (tx) => {
      const currentActor = await actor(tx, req);
      const role = await tx.m_role.findUnique({ where: { id: value.role_id } });
      if (!role?.is_active) fail(400, 'Pilih role aktif');
      const existing = method === 'put' ? await tx.user_default.findUnique({ where: { id: req.params.id }, include: { role: true } }) : null;
      if (method === 'put' && !existing) fail(404, 'User tidak ditemukan');
      if (!isSuper(currentActor) && (role.system_key === 'SUPER_ADMIN' || existing?.role.system_key === 'SUPER_ADMIN')) fail(403, 'Admin tidak dapat mengelola Super Admin');
      if (existing?.is_active && existing.role.system_key === 'SUPER_ADMIN' && (!value.is_active || role.system_key !== 'SUPER_ADMIN')) {
        if (await tx.user_default.count({ where: { is_active: true, role: { system_key: 'SUPER_ADMIN' } } }) <= 1) fail(409, 'Super Admin aktif terakhir harus dipertahankan');
      }
      const { password: ignored, ...rest } = value;
      const payload = { ...rest, username: rest.username.toLowerCase(), ...(password_hash ? { password_hash } : {}) };
      const saved = method === 'post' ? await tx.user_default.create({ data: payload, include: { role: true } }) : await tx.user_default.update({ where: { id: req.params.id }, data: payload, include: { role: true } });
      if (password_hash || !value.is_active) await tx.auth_session.deleteMany({ where: { user_id: saved.id } });
      return publicUser(saved);
    });
    res.status(method === 'post' ? 201 : 200).json({ status: 'success', data });
  }));
  roles[method](method === 'post' ? '/with-details' : '/with-details/:id', wrap(async (req, res) => {
    const { m_role_d, ...value } = validate(roleSchema, req.body);
    const data = await securityTransaction(async (tx) => {
      await actor(tx, req);
      if (method === 'put') {
        const old = await tx.m_role.findUnique({ where: { id: req.params.id } });
        if (!old) fail(404, 'Role tidak ditemukan');
        if (old.system_key) fail(409, 'Role sistem tidak dapat diubah; buat role baru untuk izin khusus');
      }
      const menuIds = m_role_d.map((p) => p.m_menu_id);
      const menus = await tx.m_menu.findMany({ where: { id: { in: menuIds } } });
      if (menus.length !== menuIds.length) fail(400, 'Menu tidak ditemukan');
      if (menus.some((m) => ['/setup/menu', '/setup/user_default', '/setup/m_role'].includes(m.path))) fail(400, 'Menu pengelolaan sistem hanya untuk role sistem');
      if (m_role_d.some((p) => !p.is_read && (p.is_create || p.is_update || p.is_delete || p.is_print))) fail(400, 'Izin aksi memerlukan izin lihat');
      const saved = method === 'post'
        ? await tx.m_role.create({ data: { ...value, m_role_ds: { create: m_role_d } }, include: { m_role_ds: true } })
        : await tx.m_role.update({ where: { id: req.params.id }, data: { ...value, m_role_ds: { deleteMany: {}, create: m_role_d } }, include: { m_role_ds: true } });
      if (!value.is_active) await tx.auth_session.deleteMany({ where: { user: { role_id: saved.id } } });
      return saved;
    });
    res.status(method === 'post' ? 201 : 200).json({ status: 'success', data });
  }));
}
users.delete('/:id', wrap(async (req, res) => {
  await securityTransaction(async (tx) => {
    const currentActor = await actor(tx, req);
    const user = await tx.user_default.findUnique({ where: { id: req.params.id }, include: { role: true } });
    if (!user) fail(404, 'User tidak ditemukan');
    if (isSuper(user)) {
      if (!isSuper(currentActor)) fail(403, 'Admin tidak dapat mengelola Super Admin');
      if (user.is_active && await tx.user_default.count({ where: { is_active: true, role: { system_key: 'SUPER_ADMIN' } } }) <= 1) fail(409, 'Super Admin aktif terakhir harus dipertahankan');
    }
    await tx.user_default.delete({ where: { id: user.id } });
  });
  res.json({ status: 'success', message: 'User berhasil dihapus' });
}));
roles.delete('/:id', wrap(async (req, res) => {
  await securityTransaction(async (tx) => {
    await actor(tx, req);
    const role = await tx.m_role.findUnique({ where: { id: req.params.id } });
    if (!role) fail(404, 'Role tidak ditemukan');
    if (role.system_key) fail(409, 'Role sistem tidak dapat dihapus');
    if (await tx.user_default.count({ where: { role_id: role.id } })) fail(409, 'Role masih digunakan oleh akun');
    await tx.m_role.delete({ where: { id: role.id } });
  });
  res.json({ status: 'success', message: 'Role berhasil dihapus' });
}));
