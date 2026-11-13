import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import prisma from '../config/database.js';
import { bootstrap } from '../modules/auth/auth.service.js';
import { hashToken } from '../core/utils/helpers.js';

const base = process.env.TEST_API_URL || 'http://localhost:5000';
const marker = `test-${randomUUID()}`;
const password = randomBytes(18).toString('hex');

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

async function request(path, method = 'GET', body, token) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { code: response.status, ...(await response.json()) };
}
test('Authentication, account lifecycle and role boundaries', async () => {
  const users = [], roles = [], menus = [];
  try {
    await warmUp();
    const empty = await prisma.user_default.count() === 0;
    if (empty) {
      const first = await bootstrap({ username: marker, name: marker, password });
      assert.equal(first.created, true); users.push(first.id);
      assert.equal((await bootstrap({ username: marker, name: marker, password: 'DifferentPassword123' })).created, false);
    }
    const superRole = await prisma.m_role.findUnique({ where: { system_key: 'SUPER_ADMIN' } });
    const adminRole = await prisma.m_role.findUnique({ where: { system_key: 'ADMIN' } });
    assert.ok(superRole && adminRole, 'Run setup:admin first if testing an existing database');
    if (!empty) {
      const user = await prisma.user_default.create({ data: { name: marker, username: marker, password_hash: await bcrypt.hash(password, 12), role_id: superRole.id } });
      users.push(user.id);
    }
    assert.equal((await request('/dynamic/m_menu')).code, 401);
    assert.equal((await request('/auth/login', 'POST', { username: marker, password: 'wrong' })).code, 401);
    const login = await request('/auth/login', 'POST', { username: marker, password });
    assert.equal(login.code, 200); const root = login.token;
    assert.equal(login.data.user.password_hash, undefined);
    assert.equal(login.data.user.password, undefined);
    if (empty) {
      assert.equal((await request(`/dynamic/user_default/${users[0]}`, 'DELETE', undefined, root)).code, 409);
      assert.equal((await request(`/dynamic/user_default/${users[0]}`, 'PUT', { name: marker, username: marker, role_id: adminRole.id, is_active: true }, root)).code, 409);
    }
    const menu = await request('/dynamic/m_menu', 'POST', { name: marker, modul: 'Test', path: '/test-work', seq: '2.1' }, root);
    assert.equal(menu.code, 201); menus.push(menu.data.id);
    const roleBody = { nama_role: marker, is_active: true, m_role_d: [{ m_menu_id: menu.data.id, is_read: true, is_create: false }] };
    const role = await request('/dynamic/m_role/with-details', 'POST', roleBody, root);
    assert.equal(role.code, 201); roles.push(role.data.id);
    const body = { name: marker, username: marker + '-worker', password, role_id: role.data.id, is_active: true };
    const created = await request('/dynamic/user_default', 'POST', body, root);
    assert.equal(created.code, 201); users.push(created.data.id);
    assert.equal((await request('/dynamic/user_default', 'POST', body, root)).code, 409);
    const workerLogin = await request('/auth/login', 'POST', { username: body.username, password });
    const worker = workerLogin.token;
    assert.equal(workerLogin.code, 200);
    assert.equal(workerLogin.data.user.permissions[menu.data.id].is_create, false);
    assert.equal((await request('/dynamic/user_default', 'GET', undefined, worker)).code, 403);
    assert.equal((await request('/dynamic/m_role', 'GET', undefined, worker)).code, 403);
    assert.equal((await request('/dynamic/m_menu', 'POST', {name: 'denied'}, worker)).code, 403);
    assert.equal((await request(`/dynamic/m_role/${role.data.id}`, 'DELETE', undefined, root)).code, 409);
    // Permission edits are reflected in a live session.
    assert.equal((await request(`/dynamic/m_role/with-details/${role.data.id}`, 'PUT', {...roleBody, m_role_d: [{m_menu_id:menu.data.id,is_read:true,is_create:true}]}, root)).code, 200);
    assert.equal((await request('/auth/me', 'GET', undefined, worker)).data.permissions[menu.data.id].is_create, true);
    const {password: omitted, ...edit} = body;
    assert.equal((await request(`/dynamic/user_default/${created.data.id}`, 'PUT', {...edit, role_id: adminRole.id}, root)).code, 200);
    assert.equal((await request('/auth/me', 'GET', undefined, worker)).data.role.system_key, 'ADMIN');
    assert.equal((await request('/dynamic/user_default', 'GET', undefined, worker)).code, 200);
    assert.equal((await request('/dynamic/m_menu', 'GET', undefined, worker)).code, 403);
    assert.equal((await request('/dynamic/user_default', 'POST', {...body,username:marker+'-evil',role_id:superRole.id}, worker)).code, 403);
    assert.equal((await request(`/dynamic/user_default/${users[0]}`, 'DELETE', undefined, worker)).code, 403);
    assert.equal((await request('/dynamic/m_role/with-details', 'POST', {...roleBody,system_key:'SUPER_ADMIN'}, worker)).code, 400);
    const adminCreated = await request('/dynamic/user_default', 'POST', {...body,username:marker+'-admin',role_id:adminRole.id}, worker);
    assert.equal(adminCreated.code,201); users.push(adminCreated.data.id);
    // Keeping password omitted preserves login; resetting invalidates old sessions.
    assert.equal((await request('/auth/login', 'POST', {username:body.username,password})).code,200);
    assert.equal((await request(`/dynamic/user_default/${created.data.id}`, 'PUT', {...edit,password:password+'x'}, root)).code,200);
    assert.equal((await request('/auth/me','GET',undefined,worker)).code,401);
    const reset = await request('/auth/login','POST',{username:body.username,password:password+'x'});
    assert.equal(reset.code,200);
    await request(`/dynamic/user_default/${created.data.id}`,'PUT',{...edit,is_active:false},root);
    assert.equal((await request('/auth/me','GET',undefined,reset.token)).code,401);
    assert.equal((await request('/auth/login','POST',{username:body.username,password:password+'x'})).code,401);
    const another = await request('/auth/login','POST',{username:marker,password});
    await prisma.auth_session.update({where:{token_hash:hashToken(another.token)},data:{expires_at:new Date(0)}});
    assert.equal((await request('/auth/me','GET',undefined,another.token)).code,401);
    assert.equal((await request('/auth/logout','POST',{},root)).code,200);
    assert.equal((await request('/auth/me','GET',undefined,root)).code,401);
  } finally {
    await prisma.user_default.deleteMany({where:{id:{in:users}}});
    await prisma.m_role.deleteMany({where:{id:{in:roles}}});
    await prisma.m_menu.deleteMany({where:{id:{in:menus}}});
    await prisma.$disconnect();
  }
});
