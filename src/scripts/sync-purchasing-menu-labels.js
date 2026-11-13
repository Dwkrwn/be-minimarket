import prisma from "../config/database.js";
import { PURCHASING_MENUS } from "./data/purchasing-menu-specs.js";

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

// Hanya menyelaraskan label menu. Path, seq, icon, sub_modul, status aktif,
// dan permission role tidak diubah agar akses yang sudah berjalan tetap aman.
async function syncPurchasingMenuLabels() {
  console.log("Sinkronisasi label menu Purchasing...");
  const updated = [];
  const unchanged = [];
  const missing = [];

  try {
    await withRetry(async () => {
      for (const spec of PURCHASING_MENUS) {
        const menu = await prisma.m_menu.findFirst({
          where: { modul: "PURCHASING", path: spec.path },
          select: { id: true, name: true },
        });

        if (!menu) {
          missing.push(`${spec.seq} ${spec.path}`);
          continue;
        }

        if (menu.name === spec.name) {
          unchanged.push(spec.seq);
          continue;
        }

        await prisma.m_menu.update({
          where: { id: menu.id },
          data: { name: spec.name },
        });
        updated.push(`${spec.seq} ${menu.name} -> ${spec.name}`);
      }
    });

    updated.forEach((line) => console.log(`  ~ ${line}`));
    console.log(`Selesai: ${updated.length} diperbarui, ${unchanged.length} sudah sesuai.`);

    if (missing.length > 0) {
      missing.forEach((line) => console.warn(`  ! menu tidak ditemukan: ${line}`));
      console.warn(`Ada ${missing.length} menu yang belum terdaftar. Jalankan seed menu terkait lebih dulu.`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

syncPurchasingMenuLabels().catch((error) => {
  console.error("Gagal sinkronisasi label menu Purchasing:", error);
  process.exit(1);
});
