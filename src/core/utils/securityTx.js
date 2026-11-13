import prisma from "../../config/database.js";

/**
 * Transaksi tulis yang menyentuh stok/kas/dokumen berurutan.
 * Advisory lock global membuat penomoran dokumen dan mutasi stok tidak saling balapan.
 */
export const securityTransaction = (fn, options = {}) =>
  prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(827341)`;
      return fn(tx);
    },
    { timeout: 15000, ...options },
  );
