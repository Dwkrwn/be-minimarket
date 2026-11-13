-- P0 #1-#4: Satu invoice per Purchase Order, agregasi seluruh Goods Receipt
-- dan seluruh retur pembelian.
--
-- Perubahan:
--   1. t_purchase_invoice.gr_id tidak lagi wajib (invoice mewakili semua GR).
--   2. t_purchase_invoice.return_id dihapus; relasi dipindah ke
--      t_purchase_return.invoice_id (satu invoice memiliki banyak retur).
--   3. unique(po_id) agar satu PO hanya bisa punya satu invoice.
--
-- Catatan: migrasi ini ditulis manual karena `prisma migrate dev` gagal pada
-- shadow database akibat migrasi lama 20261102090000_inventory_purchasing_pos
-- (relasi "inv_damaged_logs" tidak ada). Jalankan dengan `prisma migrate deploy`.

-- 1) Invoice mewakili seluruh Goods Receipt pada PO, bukan satu GR.
ALTER TABLE "t_purchase_invoice" ALTER COLUMN "gr_id" DROP NOT NULL;

-- 2) Retur sekarang menunjuk ke invoice (banyak retur -> satu invoice).
ALTER TABLE "t_purchase_return" ADD COLUMN "invoice_id" UUID;

-- Backfill data lama: invoice.return_id -> retur.invoice_id (aman jika kosong).
UPDATE "t_purchase_return" AS r
SET "invoice_id" = i."id"
FROM "t_purchase_invoice" AS i
WHERE i."return_id" = r."id";

-- Lepas relasi lama invoice.return_id.
ALTER TABLE "t_purchase_invoice" DROP CONSTRAINT IF EXISTS "t_purchase_invoice_return_id_fkey";
ALTER TABLE "t_purchase_invoice" DROP COLUMN IF EXISTS "return_id";

-- Pasang relasi baru retur -> invoice.
ALTER TABLE "t_purchase_return"
  ADD CONSTRAINT "t_purchase_return_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "t_purchase_invoice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Satu PO hanya boleh punya satu invoice.
CREATE UNIQUE INDEX IF NOT EXISTS "t_purchase_invoice_po_id_key"
  ON "t_purchase_invoice"("po_id");
