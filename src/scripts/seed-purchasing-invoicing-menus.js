import prisma from "../config/database.js";
import { PURCHASING_MENUS } from "./data/purchasing-menu-specs.js";

// Supabase pooler kadang menutup koneksi pertama dari proses baru (P1017).
// Seed bersifat idempotent, jadi aman diulang beberapa kali.
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

// Menu Purchasing tahap 4 & 5. Hanya ADMIN dan SUPER_ADMIN yang boleh melihat.
// GUDANG & KASIR tidak mendapat baris m_role_d sama sekali.
const MENUS = PURCHASING_MENUS.filter((menu) => ["4.1", "4.2", "5.1"].includes(menu.seq));

const ALLOWED_ROLES = ["ADMIN", "SUPER_ADMIN"];
const BLOCKED_ROLES = ["GUDANG", "KASIR"];

async function seedPurchasingInvoicingMenus() {
  console.log("Seeding menu Purchasing 4.1, 4.2, 5.1...");
  try {
    await withRetry(async () => {
      const roles = await prisma.m_role.findMany({
        where: { system_key: { in: [...ALLOWED_ROLES, ...BLOCKED_ROLES] } },
        select: { id: true, nama_role: true, system_key: true },
      });
      const allowedRoles = roles.filter((role) => ALLOWED_ROLES.includes(role.system_key));
      const blockedRoles = roles.filter((role) => BLOCKED_ROLES.includes(role.system_key));

      if (allowedRoles.length === 0) {
        throw new Error("Role ADMIN / SUPER_ADMIN tidak ditemukan");
      }

      for (const spec of MENUS) {
        let menu = await prisma.m_menu.findFirst({
          where: { modul: "PURCHASING", path: spec.path },
        });

        const data = {
          name: spec.name,
          desc: spec.desc,
          icon: spec.icon,
          seq: spec.seq,
          modul: "PURCHASING",
          sub_modul: spec.sub_modul,
          path: spec.path,
          parent: null,
          is_active: true,
        };

        if (menu) {
          menu = await prisma.m_menu.update({ where: { id: menu.id }, data });
          console.log(`  ~ ${spec.seq} ${spec.name} (diperbarui)`);
        } else {
          menu = await prisma.m_menu.create({ data });
          console.log(`  + ${spec.seq} ${spec.name} (dibuat)`);
        }

        for (const role of allowedRoles) {
          await prisma.m_role_d.upsert({
            where: {
              m_role_id_m_menu_id: { m_role_id: role.id, m_menu_id: menu.id },
            },
            update: {
              is_read: true,
              is_create: true,
              is_update: true,
              is_delete: false,
              is_print: true,
            },
            create: {
              m_role_id: role.id,
              m_menu_id: menu.id,
              is_read: true,
              is_create: true,
              is_update: true,
              is_delete: false,
              is_print: true,
            },
          });
        }

        if (blockedRoles.length > 0) {
          const removed = await prisma.m_role_d.deleteMany({
            where: {
              m_menu_id: menu.id,
              m_role_id: { in: blockedRoles.map((role) => role.id) },
            },
          });
          if (removed.count > 0) {
            console.log(`    - mencabut ${removed.count} akses GUDANG/KASIR`);
          }
        }
      }

      console.log("Selesai: 3 menu Purchasing 4.1/4.2/5.1 siap untuk ADMIN & SUPER_ADMIN.");
    });
  } finally {
    await prisma.$disconnect();
  }
}

seedPurchasingInvoicingMenus().catch((error) => {
  console.error("Gagal seeding menu Purchasing 4.1/4.2/5.1:", error);
  process.exit(1);
});
