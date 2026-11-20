// =============================================================================
// POS - REKAP PENJUALAN & PERENCANAAN RESTOCK (ROP -> AUTO-PR)
// Logika murni (tanpa akses DB) agar aturan 3.2 dapat diuji.
// =============================================================================

/**
 * Membaca flag boolean dari query string.
 * Catatan: `"false"` dari query string adalah truthy di JS, sehingga harus
 * dinormalkan secara eksplisit.
 */
export function parseBooleanFlag(value, defaultValue = true) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}

export function parseWindowDays(value, { defaultValue = 7, max = 366 } = {}) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const days = Number(value);
  if (!Number.isInteger(days) || days <= 0 || days > max) {
    throw Object.assign(
      new Error(`Periode rekap (days_window) harus bilangan bulat 1-${max} hari`),
      { status: 400 },
    );
  }
  return days;
}

/**
 * Rasio batas "Mendekati ROP".
 * Nilai ini harus sama dengan yang dipakai halaman Batasan Pemesanan Barang (ROP)
 * agar status pada halaman ROP dan Rekomendasi Belanja tidak pernah berbeda.
 */
export const RESTOCK_WARNING_RATIO = 1.25;

/**
 * Satu-satunya definisi status restock yang dipakai backend.
 *
 * - RESTOCK : stok <= ROP
 * - WARNING : ROP < stok <= ceil(ROP * 1.25)  ("Mendekati ROP")
 * - SAFE    : selain itu
 */
export function computeRestockStatus(totalStock, ropPcs) {
  const total = Number(totalStock) || 0;
  const rop = Number(ropPcs) || 0;
  const warningLimit = Math.ceil(rop * RESTOCK_WARNING_RATIO);

  if (total <= rop) {
    return { key: "RESTOCK", needsRestock: true, isBelowRop: true, warningLimit };
  }

  if (rop > 0 && total <= warningLimit) {
    return { key: "WARNING", needsRestock: true, isBelowRop: false, warningLimit };
  }

  return { key: "SAFE", needsRestock: false, isBelowRop: false, warningLimit };
}

/**
 * Menghitung parameter ROP dan rencana belanja untuk satu item.
 *
 * @param {object} args
 * @param {object} args.item            m_item (rop_setting, stocks, uom)
 * @param {number} args.totalSoldPcs    Total qty terjual dalam window
 * @param {number} args.windowDays      Panjang window (hari)
 * @param {number|null} args.ropOverride Nilai ROP tersimpan (m_item_rop.rop_pcs).
 *        Bila diisi, status dan saran beli memakai angka tersimpan ini supaya
 *        identik dengan halaman Batasan Pemesanan Barang (ROP).
 */
export function computeRestockPlan({
  item,
  totalSoldPcs = 0,
  windowDays = 7,
  ropOverride = null,
}) {
  const avgDailySales = Number((Number(totalSoldPcs) / windowDays).toFixed(2));

  const leadTime = item.rop_setting?.lead_time_days ?? 3;
  const safetyStock = item.rop_setting?.safety_stock_pcs ?? 10;
  const maxStock = item.rop_setting?.max_stock_pcs ?? 100;

  const computedRopPcs = Math.ceil(avgDailySales * leadTime + safetyStock);
  const hasOverride =
    ropOverride !== null && ropOverride !== undefined && ropOverride !== "";
  const ropPcs = hasOverride
    ? Math.max(0, Math.floor(Number(ropOverride)))
    : computedRopPcs;

  const totalCurrentStock = (item.stocks || []).reduce(
    (acc, stock) => acc + Number(stock.qty || 0),
    0,
  );
  const status = computeRestockStatus(totalCurrentStock, ropPcs);

  // Menghormati pengaturan per barang; default aktif bila belum ada setting.
  const autoPrEnabled = item.rop_setting?.is_auto_pr !== false;

  const conversionRatio = Number(item.uom?.rasio_konversi) || 1;
  const neededPcs = Math.max(maxStock - totalCurrentStock, ropPcs * 2);
  const qtySaranBeli = Math.max(1, Math.ceil(neededPcs / conversionRatio));
  const qtySaranPcs = qtySaranBeli * conversionRatio;

  return {
    avgDailySales,
    leadTime,
    safetyStock,
    maxStock,
    ropPcs,
    computedRopPcs,
    warningLimit: status.warningLimit,
    totalCurrentStock,
    isBelowRop: status.isBelowRop,
    needsRestock: status.needsRestock,
    status: status.key,
    autoPrEnabled,
    conversionRatio,
    qtySaranBeli,
    qtySaranPcs,
  };
}
