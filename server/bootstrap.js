import bcrypt from 'bcryptjs';
import { fail, securityTransaction } from './security.js';

export async function bootstrap({ username, name, password }) {
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(username) || !name?.trim() || name.length > 100 || typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) fail(400, 'Nama/username tidak valid atau password harus 8–72 byte');
  const password_hash = await bcrypt.hash(password, 12);
  return securityTransaction(async (tx) => {
    const superRole = await tx.m_role.upsert({ where: { system_key: 'SUPER_ADMIN' }, update: {}, create: { nama_role: 'Super Admin', system_key: 'SUPER_ADMIN' } });
    await tx.m_role.upsert({ where: { system_key: 'ADMIN' }, update: {}, create: { nama_role: 'Admin', system_key: 'ADMIN' } });
    if (!await tx.m_role.findUnique({ where: { nama_role: 'Karyawan' } })) await tx.m_role.create({ data: { nama_role: 'Karyawan' } });
    for (const [name, path, seq, icon] of [['Menu', '/setup/menu', '1.1', 'Menu'], ['User', '/setup/user_default', '1.2', 'Users'], ['Role', '/setup/m_role', '1.3', 'Shield']]) {
      if (!await tx.m_menu.findFirst({ where: { path } })) await tx.m_menu.create({ data: { name, path, seq, icon, modul: 'SETUP', is_active: true } });
    }
    if (await tx.user_default.count()) return { created: false };
    const user = await tx.user_default.create({ data: { username: username.toLowerCase(), name: name.trim(), password_hash, role_id: superRole.id } });
    return { created: true, id: user.id };
  });
}
