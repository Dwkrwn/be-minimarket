import prisma from "../config/database.js";

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

// Seed contoh modul Purchasing: 1 supplier + katalog harga untuk seluruh barang
// yang sudah ada. Idempotent: aman dijalankan berulang.
async function seedPurchasing() {
  console.log("Seeding baseline Purchasing data (Supplier + Katalog Harga)...");
  try {
    await withRetry(async () => {
      const supplier = await prisma.m_supplier.upsert({
        where: { kode_supplier: "SUP-001" },
        update: {
          nama_supplier: "PT Sumber Rejeki Makmur",
          kontak_sales: "Budi Santoso",
          no_telp: "021-5550101",
          no_wa: "6281234567890",
          alamat: "Jl. Raya Distribusi No. 12, Jakarta Timur",
          term_of_payment: 14,
          catatan: "Supplier contoh untuk uji alur pembelian",
          is_active: true,
        },
        create: {
          kode_supplier: "SUP-001",
          nama_supplier: "PT Sumber Rejeki Makmur",
          kontak_sales: "Budi Santoso",
          no_telp: "021-5550101",
          no_wa: "6281234567890",
          alamat: "Jl. Raya Distribusi No. 12, Jakarta Timur",
          term_of_payment: 14,
          catatan: "Supplier contoh untuk uji alur pembelian",
          is_active: true,
        },
      });

      console.log("Supplier siap:", supplier.nama_supplier);

      const items = await prisma.m_item.findMany({
        where: { is_active: true },
        select: { id: true, nama_barang: true, harga_modal: true },
        orderBy: { nama_barang: "asc" },
      });

      for (const item of items) {
        // Harga katalog contoh = harga modal master (bisa diubah dari UI 1.2).
        const hargaModal = Number(item.harga_modal) || 1000;
        await prisma.m_supplier_catalog.upsert({
          where: {
            supplier_id_item_id: { supplier_id: supplier.id, item_id: item.id },
          },
          update: {},
          create: {
            supplier_id: supplier.id,
            item_id: item.id,
            harga_modal: hargaModal,
            is_active: true,
          },
        });
        console.log(`Katalog: ${item.nama_barang} @ ${hargaModal} / Pcs`);
      }
    });

    console.log("✅ Seeding Purchasing Sample Selesai Sukses!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Gagal Seeding Purchasing:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedPurchasing();
