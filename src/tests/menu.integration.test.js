import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../config/database.js';
import { hashToken } from '../core/utils/helpers.js';
import { randomBytes } from 'node:crypto';

const base = process.env.TEST_API_URL || 'http://localhost:5000';
const token = randomBytes(32).toString('hex');

// Supabase pooler kadang menutup koneksi pertama dari proses baru (P1017).
async function warmUp(attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}/dynamic/m_menu${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { code: response.status, ...(await response.json()) };
}
test('Setup Menu: CRUD, search, pagination, sequence, validation and CORS', async () => {
  const marker = `test-${randomUUID()}`;
  const ids = [];
  await warmUp();
  const role = await prisma.m_role.findUniqueOrThrow({where:{system_key:'SUPER_ADMIN'}});
  const user = await prisma.user_default.create({data:{name:marker,username:marker,password_hash:'not-a-login-hash',role_id:role.id}});
  await prisma.auth_session.create({data:{token_hash:hashToken(token),user_id:user.id,expires_at:new Date(Date.now()+60000)}});
  try {
    for (const seq of ['1.10', '1.2']) {
      const created = await request('', 'POST', { name: marker, modul: 'Setup', sub_modul: 'Test', path: '/setup/menu', seq, is_active: true });
      assert.equal(created.code, 201);
      ids.push(created.data.id);
      assert.equal(created.data.seq, seq);
      assert.ok(created.data.createdAt);
    }
    const list = await request(`?search=${marker}&searchfield=name&order_by=seq&order_type=ASC&paginate=1`);
    assert.equal(list.pagination.total, 2);
    assert.equal(list.pagination.next_page, 2);
    assert.equal(list.data[0].seq, '1.2');
    const all = await request(`?search=${marker}&no_pagination=true&order_by_raw=seq%20ASC`);
    assert.deepEqual(all.data.map((row) => row.seq), ['1.2', '1.10']);
    const updated = await request(`/${ids[0]}`, 'PUT', { name: marker, modul: 'Setup', path: '/setup/menu', sub_modul: 'Updated', seq: '2.1', is_active: false });
    assert.equal(updated.code, 200);
    const detail = await request(`/${ids[0]}`);
    assert.equal(detail.data.is_active, false);
    assert.equal(detail.data.sub_modul, 'Updated');
    assert.equal((await request('', 'POST', { name: '' })).code, 400);
    assert.equal((await request('?order_by=invalid')).code, 400);
    assert.equal((await request('/invalid')).code, 400);
    assert.equal((await request(`/${randomUUID()}`)).code, 404);
    const cors = await fetch(`${base}/dynamic/m_menu`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(cors.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    for (const id of ids) assert.equal((await request(`/${id}`, 'DELETE')).code, 200);
    assert.equal((await request(`/${ids[0]}`)).code, 404);
  } finally {
    for (const id of ids) await request(`/${id}`, 'DELETE');
    await prisma.user_default.delete({where:{id:user.id}});
    await prisma.$disconnect();
  }
});
