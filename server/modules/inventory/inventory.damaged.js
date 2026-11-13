// =============================================================================
// INVENTORY - IZIN PELAPORAN BARANG RUSAK
// Kasir tidak memiliki akses modul inventory. Laporan barang rusak hanya untuk
// GUDANG/ADMIN/SUPER_ADMIN; transaksi kasir hanya mengurangi stok lewat POS.
// =============================================================================

import { fail } from "../../../src/core/utils/helpers.js";

export function assertDamagedReportAllowed({ user } = {}) {
  // Pemanggilan internal/legacy tanpa objek user tidak dibatasi di sini.
  if (!user || typeof user !== "object" || !user.role) return;

  if (user.role.system_key === "KASIR") {
    fail(
      403,
      "Kasir tidak memiliki akses modul inventory. " +
        "Transaksi kasir hanya mengurangi stok lewat POS",
    );
  }
}
