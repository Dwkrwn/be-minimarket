import prisma from "../config/database.js";
import {
  POS_BLOCKED_ROLES,
  POS_MENUS,
  POS_ROLE_GRANTS,
} from "./data/pos-menu-specs.js";

// Supabase pooler kadang menutup koneksi pertama dari proses baru (P1017).
// Operasi ini idempotent, jadi aman diulang beberapa kali.
async function withRetry(operation, attempts = 6) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(`Percobaan ${attempt} gagal (${error.code || error.message}), mencoba ulang...`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

const DRY_RUN = process.argv.includes("--dry-run");
const MODULE = "POS";

async function syncPosMenus() {
  console.log(`Sinkronisasi menu POS (Transaksi)${DRY_RUN ? " [DRY RUN]" : ""}...`);

  try {
    await withRetry(async () => {
      const roleKeys = Object.keys(POS_ROLE_GRANTS);
      const roles = await prisma.m_role.findMany({
        where: { system_key: { in: [...roleKeys, ...POS_BLOCKED_ROLES] } },
        select: { id: true, nama_role: true, system_key: true },
      });

      const missingRoles = roleKeys.filter(
        (key) => !roles.some((role) => role.system_key === key),
      );
      if (missingRoles.length > 0) {
        throw new Error(`Role tidak ditemukan: ${missingRoles.join(", ")}`);
      }

      const blockedRoles = roles.filter((role) =>
        POS_BLOCKED_ROLES.includes(role.system_key),
      );

      const menuBySeq = new Map();
      let created = 0;
      let updated = 0;
      let unchanged = 0;

      for (const spec of POS_MENUS) {
        const existing = await prisma.m_menu.findFirst({
          where: { modul: MODULE, path: spec.path },
        });

        const data = {
          name: spec.name,
          desc: spec.desc,
          icon: spec.icon,
          seq: spec.seq,
          modul: MODULE,
          sub_modul: spec.sub_modul,
          path: spec.path,
          parent: null,
          is_active: true,
        };

        if (!existing) {
          if (DRY_RUN) {
            console.log(`  + ${spec.seq} ${spec.name} (akan dibuat)`);
            created += 1;
            continue;
          }
          const menu = await prisma.m_menu.create({ data });
          menuBySeq.set(spec.seq, menu);
          console.log(`  + ${spec.seq} ${spec.name} (dibuat)`);
          created += 1;
          continue;
        }

        menuBySeq.set(spec.seq, existing);
        const changed =
          existing.name !== data.name ||
          existing.desc !== data.desc ||
          existing.icon !== data.icon ||
          existing.seq !== data.seq ||
          existing.modul !== data.modul ||
          existing.sub_modul !== data.sub_modul ||
          existing.path !== data.path ||
          existing.is_active !== data.is_active;

        if (!changed) {
          console.log(`  = ${spec.seq} ${spec.name} (sudah sesuai)`);
          unchanged += 1;
          continue;
        }

        if (DRY_RUN) {
          console.log(`  ~ ${spec.seq} ${spec.name} (akan diperbarui)`);
          updated += 1;
          continue;
        }

        await prisma.m_menu.update({ where: { id: existing.id }, data });
        console.log(`  ~ ${spec.seq} ${spec.name} (diperbarui)`);
        updated += 1;
      }

      if (!DRY_RUN) {
        // Saat menu baru dibuat, ambil ulang agar grant memakai id valid.
        for (const spec of POS_MENUS) {
          if (menuBySeq.has(spec.seq)) continue;
          const menu = await prisma.m_menu.findFirst({
            where: { modul: MODULE, path: spec.path },
            select: { id: true },
          });
          if (menu) menuBySeq.set(spec.seq, menu);
        }
      }

      let granted = 0;
      let revoked = 0;

      for (const [roleKey, config] of Object.entries(POS_ROLE_GRANTS)) {
        const role = roles.find((row) => row.system_key === roleKey);
        for (const seq of config.seqs) {
          const menu = menuBySeq.get(seq);
          if (!menu) {
            if (DRY_RUN) {
              console.log(`  ~ grant ${roleKey} -> ${seq} (menunggu menu dibuat)`);
            }
            continue;
          }

          if (DRY_RUN) {
            const existingGrant = await prisma.m_role_d.findUnique({
              where: {
                m_role_id_m_menu_id: { m_role_id: role.id, m_menu_id: menu.id },
              },
              select: { id: true },
            });
            console.log(
              `  ~ grant ${roleKey} -> ${seq} (${existingGrant ? "sudah ada" : "akan dibuat"})`,
            );
            continue;
          }

          await prisma.m_role_d.upsert({
            where: {
              m_role_id_m_menu_id: { m_role_id: role.id, m_menu_id: menu.id },
            },
            update: config.perms,
            create: { m_role_id: role.id, m_menu_id: menu.id, ...config.perms },
          });
          granted += 1;
        }
      }

      if (!DRY_RUN) {
        // Revoke akses POS dari role yang diblokir berdasarkan modul POS.
        const posMenus = await prisma.m_menu.findMany({
          where: { modul: MODULE },
          select: { id: true },
        });
        if (posMenus.length > 0 && blockedRoles.length > 0) {
          const result = await prisma.m_role_d.deleteMany({
            where: {
              m_role_id: { in: blockedRoles.map((role) => role.id) },
              m_menu_id: { in: posMenus.map((menu) => menu.id) },
            },
          });
          revoked += result.count;
        }
      }

      console.log(
        `Selesai: ${created} dibuat, ${updated} diperbarui, ${unchanged} sudah sesuai, ` +
          `${granted} grant disinkronkan${revoked > 0 ? `, ${revoked} akses role diblokir dicabut` : ""}.`,
      );

      if (DRY_RUN) {
        // Jangan biarkan dry-run mengubah database.
        console.log("DRY RUN: tidak ada perubahan yang ditulis.");
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

syncPosMenus().catch((error) => {
  console.error("Gagal sinkronisasi menu POS:", error);
  process.exit(1);
});
