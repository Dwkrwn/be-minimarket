import { Router } from 'express';
import Joi from 'joi';
import prisma from '../config/database.js';

const router = Router();
const text = Joi.string().trim().max(100);
const schema = Joi.object({
  name: text.required(), modul: text.required(), path: text.required(),
  sub_modul: text.allow('', null), icon: text.allow('', null),
  desc: Joi.string().allow('', null),
  seq: text.pattern(/^\d+(\.\d+)*$/).allow('', null),
  is_active: Joi.boolean().strict(),
});
const fields = ['name', 'modul', 'sub_modul', 'path', 'seq', 'desc', 'icon'];
const wrap = (handler) => async (req, res, next) => {
  try { await handler(req, res); } catch (error) { next(error); }
};
router.param('id', (req, res, next, id) => {
  if (Joi.string().guid().validate(id).error) return res.status(400).json({ status: 'error', message: 'ID menu tidak valid' });
  next();
});
router.get('/', wrap(async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.paginate || 10);
  const order = req.query.order_by_raw === 'seq ASC' ? 'seq' : req.query.order_by || 'createdAt';
  const direction = req.query.order_by_raw === 'seq ASC' ? 'ASC' : req.query.order_type || 'DESC';
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 ||
      ![...fields, 'createdAt', 'updatedAt', 'is_active'].includes(order) || !['ASC', 'DESC'].includes(direction)) {
    return res.status(400).json({ status: 'error', message: 'Parameter daftar menu tidak valid' });
  }
  const search = String(req.query.search || '').trim();
  const searchFields = String(req.query.searchfield || 'name,modul,sub_modul,path').split(',');
  if (searchFields.some((field) => !fields.includes(field))) return res.status(400).json({ status: 'error', message: 'Field pencarian tidak valid' });
  const where = search ? { OR: searchFields.map((field) => ({ [field]: { contains: search, mode: 'insensitive' } })) } : {};
  const rows = await prisma.m_menu.findMany({ where, orderBy: [{ [order]: direction.toLowerCase() }, { id: 'asc' }] });
  if (order === 'seq') rows.sort((a, b) => (a.seq.localeCompare(b.seq, undefined, { numeric: true }) || a.id.localeCompare(b.id)) * (direction === 'ASC' ? 1 : -1));
  const total = rows.length;
  const all = req.query.no_pagination === 'true';
  const data = all ? rows : rows.slice((page - 1) * limit, page * limit);
  res.json({ status: 'success', data, pagination: { total, page: all ? 1 : page, limit: all ? total : limit,
    totalPages: all ? 1 : Math.ceil(total / limit), currentRowsCount: data.length,
    next_page: !all && page * limit < total ? page + 1 : null, prev_page: !all && page > 1 ? page - 1 : null } });
}));
router.get('/:id', wrap(async (req, res) => {
  const data = await prisma.m_menu.findUnique({ where: { id: req.params.id } });
  if (!data) return res.status(404).json({ status: 'error', message: 'Menu tidak ditemukan' });
  res.json({ status: 'success', data });
}));
for (const method of ['post', 'put']) {
  router[method](method === 'post' ? '/' : '/:id', wrap(async (req, res) => {
    const { error, value } = schema.required().validate(req.body);
    if (error) return res.status(400).json({ status: 'error', message: error.details[0].message });
    const data = { ...value, seq: value.seq || '0' };
    const saved = method === 'post' ? await prisma.m_menu.create({ data }) : await prisma.m_menu.update({ where: { id: req.params.id }, data });
    res.status(method === 'post' ? 201 : 200).json({ status: 'success', data: saved });
  }));
}
router.delete('/:id', wrap(async (req, res) => {
  await prisma.m_menu.delete({ where: { id: req.params.id } });
  res.json({ status: 'success', message: 'Menu berhasil dihapus' });
}));
export default router;
