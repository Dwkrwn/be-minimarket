import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import prisma from '../config/database.js';
import { authenticate, wrap, fail, hashToken, userInclude, profile } from '../security.js';

const router = Router();
const attempts = new Map();
const dummyHash = bcrypt.hashSync('not-a-real-account-password', 12);
router.post('/login', wrap(async (req, res) => {
  const key = req.ip;
  const now = Date.now();
  for (const [ip, value] of attempts) if (value.until <= now) attempts.delete(ip);
  const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  if (entry.count >= 10) { res.set('Retry-After', String(Math.ceil((entry.until - now) / 1000))); fail(429, 'Terlalu banyak percobaan login. Coba lagi nanti.'); }
  entry.count++;
  attempts.set(key, entry);
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || password.length > 72) fail(401, 'Username atau password salah');
  const user = await prisma.user_default.findUnique({ where: { username: username.trim().toLowerCase() }, include: userInclude });
  const valid = await bcrypt.compare(password, user?.password_hash || dummyHash);
  if (!valid || !user?.is_active || !user.role.is_active) fail(401, 'Username atau password salah');
  attempts.delete(key);
  const token = randomBytes(32).toString('hex');
  await prisma.auth_session.deleteMany({ where: { expires_at: { lte: new Date() } } });
  await prisma.auth_session.create({ data: { token_hash: hashToken(token), user_id: user.id, expires_at: new Date(now + 8 * 60 * 60 * 1000) } });
  res.json({ status: 'success', token, data: { user: await profile(user) } });
}));
router.get('/me', authenticate, wrap(async (req, res) => res.json({ status: 'success', data: await profile(req.user) })));
router.post('/logout', authenticate, wrap(async (req, res) => {
  await prisma.auth_session.deleteMany({ where: { id: req.session.id } });
  res.json({ status: 'success' });
}));
export default router;
