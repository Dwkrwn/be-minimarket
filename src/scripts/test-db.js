import prisma from "../config/database.js";

async function checkConnection() {
  console.log("Menguji koneksi ke database Supabase...");
  try {
    const result = await prisma.$queryRaw`
      SELECT 
        NOW() as waktu_server,
        current_database() as nama_database,
        current_user as user_db,
        version() as versi_postgres
    `;

    console.log("=================================================");
    console.log("✅ BERHASIL TERHUBUNG KE SUPABASE!");
    console.log("=================================================");
    console.log("Waktu Server Supabase :", result[0].waktu_server);
    console.log("Nama Database         :", result[0].nama_database);
    console.log("Database User         :", result[0].user_db);
    console.log("=================================================");

    // Cek jumlah tabel yang ada
    const tables = await prisma.$queryRaw`
      SELECT count(*)::int as total_tabel 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    console.log(`📊 Total Tabel Terdeteksi: ${tables[0].total_tabel} tabel.`);

    // Cek isi data role
    const roles = await prisma.m_role.findMany({
      select: { nama_role: true, kode_role: true, is_active: true },
    });
    console.log("🔑 Daftar Role Terdaftar:", roles);
    console.log("=================================================");
    process.exit(0);
  } catch (error) {
    console.error("=================================================");
    console.error("❌ GAGAL TERHUBUNG KE DATABASE!");
    console.error("=================================================");
    console.error("Pesan Error:", error.message);
    console.error("=================================================");
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

checkConnection();

