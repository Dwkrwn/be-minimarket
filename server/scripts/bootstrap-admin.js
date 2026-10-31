import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';
import prisma from '../config/database.js';
import { bootstrap } from '../bootstrap.js';

function secret(prompt) {
  if (!stdin.isTTY) throw new Error('Jalankan di terminal interaktif untuk memasukkan password secara tersembunyi');
  stdout.write(prompt);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const done = () => { stdin.off('keypress', handler); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
    const handler = (text, key) => {
      if (key?.ctrl && key.name === 'c') { done(); reject(new Error('Dibatalkan')); }
      else if (key?.name === 'return') { done(); resolve(value); }
      else if (key?.name === 'backspace') value = Array.from(value).slice(0, -1).join('');
      else if (text && !key?.ctrl && !key?.meta && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    };
    stdin.on('keypress', handler);
  });
}
try {
  if (await prisma.user_default.count()) {
    console.log('Akun sudah tersedia. Kelola akun melalui Setup User; password tidak diubah.');
  } else {
    const rl = createInterface({ input: stdin, output: stdout });
    const username = (await rl.question('Username Super Admin [admin]: ')).trim() || 'admin';
    const name = (await rl.question('Nama [Administrator]: ')).trim() || 'Administrator';
    rl.close();
    const password = await secret('Password (minimal 8 karakter): ');
    const confirm = await secret('Ulangi password: ');
    if (password !== confirm) throw new Error('Password tidak cocok');
    const result = await bootstrap({ username, name, password });
    console.log(result.created ? 'Super Admin dan menu Setup berhasil dibuat. Silakan login.' : 'Akun sudah tersedia; tidak ada password yang ditimpa.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
