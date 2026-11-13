// =============================================================================
// POS - KEPEMILIKAN SHIFT KASIR
// Logika murni agar aturan akses shift dapat diuji tanpa akses DB.
// =============================================================================

import { fail, isManager } from "../../../src/core/utils/helpers.js";

export function isShiftOwner(shift, user) {
  return Boolean(shift && user && shift.user_id && shift.user_id === user.id);
}

/**
 * Memastikan aktor berhak mengakses sebuah shift (P2 #10).
 *
 * - Kasir hanya boleh mengakses shift miliknya sendiri.
 * - Admin / Super Admin boleh mengakses semua shift (oversight & closing).
 * - Aktor tanpa objek user (pemanggilan internal/legacy) tidak dibatasi.
 *
 * @param {object} shift  t_cashier_shift (wajib punya user_id)
 * @param {object} user   req.user
 * @param {{ action?: string, allowManager?: boolean }} options
 */
export function assertShiftAccess(shift, user, { action = "mengakses", allowManager = true } = {}) {
  if (!shift) fail(404, "Shift kasir tidak ditemukan");
  if (!user || typeof user !== "object") return shift;

  if (allowManager && isManager(user)) return shift;

  if (!isShiftOwner(shift, user)) {
    fail(403, `Anda tidak berhak ${action} shift kasir milik kasir lain`);
  }

  return shift;
}

/**
 * Validasi shift saat checkout: harus OPEN dan milik kasir yang bertransaksi.
 * Admin tidak boleh mencatat penjualan ke shift kasir lain agar omzet tetap
 * teratribusi ke kasir pemilik shift.
 */
export function assertCheckoutShift(shift, user) {
  if (!shift || shift.status !== "OPEN") {
    fail(400, "Kasir belum membuka shift atau shift sudah ditutup. Buka shift kasir terlebih dahulu.");
  }

  return assertShiftAccess(shift, user, {
    action: "melakukan transaksi pada",
    allowManager: false,
  });
}

/**
 * Blind closing (P2 #11): selama shift masih OPEN, kasir tidak boleh melihat
 * akumulasi omzet maupun daftar transaksi karena keduanya dapat dipakai
 * menebak ekspektasi kas laci sebelum ia menghitung uang fisik.
 *
 * Admin / Super Admin tetap menerima data penuh untuk oversight.
 * Pemanggilan internal tanpa objek user (job, test, legacy) tidak diproyeksikan.
 */
export function projectActiveShift(shift, user) {
  if (!shift) return shift;
  if (!user || typeof user !== "object") return shift;
  if (isManager(user)) return shift;

  return {
    id: shift.id,
    no_shift: shift.no_shift,
    user_id: shift.user_id,
    modal_awal: shift.modal_awal,
    status: shift.status,
    opened_at: shift.opened_at,
    catatan: shift.catatan,
    user: shift.user,
  };
}

/**
 * Laporan shift (3.1) untuk kasir hanya tersedia setelah shift ditutup, agar
 * angka realisasi tidak bocor saat shift masih berjalan (blind closing).
 */
export function assertShiftReportAccess(shift, user) {
  if (!shift) fail(404, "Shift kasir tidak ditemukan");
  if (!user || typeof user !== "object") return shift;
  if (isManager(user)) return shift;

  assertShiftAccess(shift, user, { action: "melihat laporan", allowManager: false });

  if (shift.status !== "CLOSED") {
    fail(403, "Laporan shift baru dapat dilihat setelah shift kasir ditutup");
  }

  return shift;
}
