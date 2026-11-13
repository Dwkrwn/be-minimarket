/**
 * Nomor dokumen berurutan per bulan/tanggal.
 * Semua pemanggil WAJIB berada di dalam securityTransaction supaya aman dari race condition.
 */
export async function nextDocumentNumber(
  tx,
  { model, field, prefix = "DOC", date = new Date(), period = "month" },
) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const segment = period === "day" ? `${year}${month}${day}` : `${year}${month}`;
  const startsWith = `${prefix}-${segment}-`;

  const total = await tx[model].count({
    where: { [field]: { startsWith } },
  });

  return `${startsWith}${String(total + 1).padStart(4, "0")}`;
}
