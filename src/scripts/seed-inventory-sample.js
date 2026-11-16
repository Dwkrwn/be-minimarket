import prisma from "../config/database.js";

async function seedInventory() {
  console.log(
    "Seeding baseline Inventory data (Kategori/Rak, UOM, Sample Item)...",
  );
  try {
    // 1. Kategori & Zona Rak / Gudang
    const rakSusu = await prisma.m_category_rack.upsert({
      where: { kode: "R-SUSU-01" },
      update: {},
      create: {
        kode: "R-SUSU-01",
        nama: "Rak Display Minuman & Susu",
        tipe_zona: "RAK",
        lokasi: "Lorong 2 Sisi Kiri",
        catatan: "Rak display showcase pendingin dan susu",
        is_active: true,
      },
    });

    const rakSnack = await prisma.m_category_rack.upsert({
      where: { kode: "R-SNCK-01" },
      update: {},
      create: {
        kode: "R-SNCK-01",
        nama: "Rak Display Makanan Ringan",
        tipe_zona: "RAK",
        lokasi: "Lorong 1 Sisi Kanan",
        catatan: "Rak display snack dan biskuit",
        is_active: true,
      },
    });

    const gudangA1 = await prisma.m_category_rack.upsert({
      where: { kode: "G-BLOK-A1" },
      update: {},
      create: {
        kode: "G-BLOK-A1",
        nama: "Gudang Belakang Blok A1",
        tipe_zona: "GUDANG",
        lokasi: "Gudang Barat Lantai 1",
        catatan: "Penyimpanan buffer karton/kardus",
        is_active: true,
      },
    });

    // 2. Satuan & Konversi UOM
    const uomPcs = await prisma.m_uom.upsert({
      where: { kode_uom: "PCS" },
      update: {},
      create: {
        kode_uom: "PCS",
        nama_uom: "Satuan Eceran (Pcs)",
        satuan_dasar: "Pcs",
        satuan_beli: "Pcs",
        rasio_konversi: 1,
        catatan: "Satuan terkecil retail minimarket",
        is_active: true,
      },
    });

    const uomDus40 = await prisma.m_uom.upsert({
      where: { kode_uom: "DUS-40" },
      update: {},
      create: {
        kode_uom: "DUS-40",
        nama_uom: "Kardus Isi 40 Pcs",
        satuan_dasar: "Pcs",
        satuan_beli: "Kardus",
        rasio_konversi: 40,
        catatan: "1 Kardus = 40 Pcs",
        is_active: true,
      },
    });

    const uomDus24 = await prisma.m_uom.upsert({
      where: { kode_uom: "DUS-24" },
      update: {},
      create: {
        kode_uom: "DUS-24",
        nama_uom: "Kardus Isi 24 Pcs",
        satuan_dasar: "Pcs",
        satuan_beli: "Kardus",
        rasio_konversi: 24,
        catatan: "1 Kardus = 24 Pcs",
        is_active: true,
      },
    });

    // 3. Sample Item 1: Susu Ultra Milk 250ml
    const barcode1 = "8992388123456";
    let item1 = await prisma.m_item.findUnique({
      where: { barcode: barcode1 },
    });
    if (!item1) {
      item1 = await prisma.m_item.create({
        data: {
          barcode: barcode1,
          nama_barang: "Susu Ultra Milk 250ml Cokelat",
          category_rack_id: rakSusu.id,
          uom_id: uomDus40.id,
          harga_modal: 5000,
          harga_jual: 6500,
          catatan: "Produk susu cair UHT terlaris",
          is_active: true,
          stocks: {
            create: [
              { location: "GUDANG", qty: 40, category_rack_id: gudangA1.id },
              { location: "RAK", qty: 15, category_rack_id: rakSusu.id },
            ],
          },
          rop_setting: {
            create: {
              lead_time_days: 3,
              safety_stock_pcs: 10,
              avg_daily_sales: 5,
              rop_pcs: 25,
              max_stock_pcs: 150,
              is_auto_pr: true,
            },
          },
        },
      });
      console.log("Sample Item 1 created:", item1.nama_barang);
    }

    // 4. Sample Item 2: Chitato Sapi Panggang 68g
    const barcode2 = "8992761001123";
    let item2 = await prisma.m_item.findUnique({
      where: { barcode: barcode2 },
    });
    if (!item2) {
      item2 = await prisma.m_item.create({
        data: {
          barcode: barcode2,
          nama_barang: "Chitato Sapi Panggang 68g",
          category_rack_id: rakSnack.id,
          uom_id: uomDus24.id,
          harga_modal: 9000,
          harga_jual: 11500,
          catatan: "Keripik kentang rasa sapi panggang",
          is_active: true,
          stocks: {
            create: [
              { location: "GUDANG", qty: 24, category_rack_id: gudangA1.id },
              { location: "RAK", qty: 12, category_rack_id: rakSnack.id },
            ],
          },
          rop_setting: {
            create: {
              lead_time_days: 2,
              safety_stock_pcs: 8,
              avg_daily_sales: 4,
              rop_pcs: 16,
              max_stock_pcs: 100,
              is_auto_pr: true,
            },
          },
        },
      });
      console.log("Sample Item 2 created:", item2.nama_barang);
    }

    console.log("✅ Seeding Inventory Sample Selesai Sukses!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Gagal Seeding Inventory:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedInventory();
