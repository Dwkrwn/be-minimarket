import "dotenv/config";
import express from "express";
import cors from "cors";
import prisma from "./config/database.js";
import menuRouter from "./routes/menu.js";
import authRouter from './routes/auth.js';
import { users, roles } from './routes/accounts.js';
import { authenticate, managerOnly, superOnly, wrap } from './security.js';

const app = express();
const port = Number(process.env.PORT || 5000);

app.use(
  cors({
    origin: process.env.FRONTEND_URL?.split(',').map((url) => url.trim()) || ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"],
  }),
);

app.use(express.json());
app.use('/auth', authRouter);
app.use('/dynamic/user_default', authenticate, managerOnly, users);
app.use('/dynamic/m_role', authenticate, managerOnly, roles);
app.get('/auth/menu-options', authenticate, managerOnly, wrap(async (req, res) => {
  const search = String(req.query.search || '').trim();
  const data = await prisma.m_menu.findMany({ where: { is_active: true,
    NOT: { path: { in: ['/setup/menu', '/setup/user_default', '/setup/m_role'] } },
    ...(search ? { OR: ['name', 'modul', 'sub_modul', 'path'].map(field => ({ [field]: { contains: search, mode: 'insensitive' } })) } : {}),
  }, orderBy: { seq: 'asc' } });
  res.json({ status: 'success', data, hasNext: false });
}));
app.use('/dynamic/m_menu', authenticate, superOnly, menuRouter);
app.use('/api/dynamic/m_menu', authenticate, superOnly, menuRouter);
app.use((error, req, res, next) => {
  const status = error.code === 'P2025' ? 404 : error.code === 'P2003' || error.code === 'P2002' ? 409 : error.status || 500;
  if (status >= 500) console.error('Server error:', error.code || error.name);
  res.status(status).json({ status: 'error', message: error.status && status < 500 ? (error.type === 'entity.parse.failed' ? 'JSON tidak valid' : error.message) : status === 404 ? 'Data tidak ditemukan' : status === 409 ? 'Data masih digunakan atau sudah ada' : 'Gagal memproses permintaan' });
});

app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      message: "Backend berjalan",
      database: "Terhubung",
    });
  } catch (error) {
    console.error(error);

    res.status(503).json({
      message: "Database belum terhubung",
    });
  }
});

app.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`Backend berjalan di http://localhost:${port}`);
});
