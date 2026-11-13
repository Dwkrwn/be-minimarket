-- DropForeignKey
ALTER TABLE "inv_damaged_logs" DROP CONSTRAINT "inv_damaged_logs_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "inv_damaged_logs" DROP CONSTRAINT "inv_damaged_logs_item_id_fkey";

-- DropForeignKey
ALTER TABLE "inv_items" DROP CONSTRAINT "inv_items_category_id_fkey";

-- DropForeignKey
ALTER TABLE "inv_items" DROP CONSTRAINT "inv_items_rack_id_fkey";

-- DropForeignKey
ALTER TABLE "inv_stock_batches" DROP CONSTRAINT "inv_stock_batches_item_id_fkey";

-- DropForeignKey
ALTER TABLE "inv_stock_cards" DROP CONSTRAINT "inv_stock_cards_item_id_fkey";

-- DropForeignKey
ALTER TABLE "inv_stock_mutations" DROP CONSTRAINT "inv_stock_mutations_item_id_fkey";

-- DropForeignKey
ALTER TABLE "inv_stock_opname_items" DROP CONSTRAINT "inv_stock_opname_items_item_id_fkey";

-- DropForeignKey
ALTER TABLE "inv_stock_opname_items" DROP CONSTRAINT "inv_stock_opname_items_opname_id_fkey";

-- AlterTable

-- AlterTable

-- AlterTable

-- AlterTable

-- AlterTable

-- DropTable
DROP TABLE "inv_categories";

-- DropTable
DROP TABLE "inv_damaged_logs";

-- DropTable
DROP TABLE "inv_items";

-- DropTable
DROP TABLE "inv_racks";

-- DropTable
DROP TABLE "inv_stock_batches";

-- DropTable
DROP TABLE "inv_stock_cards";

-- DropTable
DROP TABLE "inv_stock_mutations";

-- DropTable
DROP TABLE "inv_stock_opname_items";

-- DropTable
DROP TABLE "inv_stock_opnames";

-- CreateTable
CREATE TABLE "m_category" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50),
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_unit" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50),
    "name" VARCHAR(50) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_rack" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50),
    "name" VARCHAR(100) NOT NULL,
    "location" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_rack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_item" (
    "id" UUID NOT NULL,
    "barcode" VARCHAR(100) NOT NULL,
    "nama_barang" VARCHAR(150) NOT NULL,
    "category_id" UUID,
    "rack_default_id" UUID,
    "base_unit" VARCHAR(50) NOT NULL,
    "harga_modal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "harga_jual" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "min_stock" INTEGER NOT NULL DEFAULT 0,
    "max_stock" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_item_unit" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "unit_name" VARCHAR(50) NOT NULL,
    "conversion" INTEGER NOT NULL,
    "is_base" BOOLEAN NOT NULL DEFAULT false,
    "is_sell_unit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_item_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_item_rack" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "rack_id" UUID NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_item_rack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_stock" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location" VARCHAR(20) NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "batch_number" VARCHAR(100),
    "expired_date" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_stock_card" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "no_dokumen" VARCHAR(100),
    "jenis_mutasi" VARCHAR(30) NOT NULL,
    "qty_in" INTEGER NOT NULL DEFAULT 0,
    "qty_out" INTEGER NOT NULL DEFAULT 0,
    "saldo_akhir" INTEGER NOT NULL DEFAULT 0,
    "location" VARCHAR(20),
    "user_id" UUID,
    "keterangan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_stock_card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_stock_mutation" (
    "id" UUID NOT NULL,
    "no_mutasi" VARCHAR(50) NOT NULL,
    "from_location" VARCHAR(20) NOT NULL,
    "to_location" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    "keterangan" TEXT,
    "user_id" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_stock_mutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_stock_mutation_d" (
    "id" UUID NOT NULL,
    "mutation_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_stock_mutation_d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_stock_opname" (
    "id" UUID NOT NULL,
    "no_opname" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "tgl_opname" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "catatan" TEXT,
    "user_id" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_stock_opname_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_stock_opname_d" (
    "id" UUID NOT NULL,
    "opname_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location" VARCHAR(20) NOT NULL,
    "qty_system" INTEGER NOT NULL,
    "qty_fisik" INTEGER NOT NULL,
    "selisih" INTEGER NOT NULL,
    "batch_number" VARCHAR(100),
    "expired_date" TIMESTAMP(3),
    "reason_code" VARCHAR(30),
    "keterangan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_stock_opname_d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_stock_adjustment" (
    "id" UUID NOT NULL,
    "no_adjustment" VARCHAR(50) NOT NULL,
    "location" VARCHAR(20) NOT NULL,
    "reason_code" VARCHAR(30) NOT NULL,
    "tgl_adjustment" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_stock_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_stock_adjustment_d" (
    "id" UUID NOT NULL,
    "adjustment_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_stock_adjustment_d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_supplier" (
    "id" UUID NOT NULL,
    "kode_supplier" VARCHAR(50) NOT NULL,
    "nama_supplier" VARCHAR(150) NOT NULL,
    "kontak_sales" VARCHAR(100),
    "no_telp" VARCHAR(50),
    "no_wa" VARCHAR(50),
    "alamat" TEXT,
    "term_of_payment" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_supplier_price" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "harga_beli" DECIMAL(18,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_supplier_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_purchase_order" (
    "id" UUID NOT NULL,
    "no_po" VARCHAR(50) NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "tgl_po" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tgl_dikirim" TIMESTAMP(3),
    "catatan" TEXT,
    "user_id" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_purchase_order_d" (
    "id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "harga_satuan" DECIMAL(18,2) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_purchase_order_d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_goods_receipt" (
    "id" UUID NOT NULL,
    "no_gr" VARCHAR(50) NOT NULL,
    "po_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    "tgl_gr" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_goods_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_goods_receipt_d" (
    "id" UUID NOT NULL,
    "gr_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty_diterima" INTEGER NOT NULL,
    "qty_ditolak" INTEGER NOT NULL DEFAULT 0,
    "batch_number" VARCHAR(100),
    "expired_date" TIMESTAMP(3),
    "harga_satuan" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_goods_receipt_d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_purchase_return" (
    "id" UUID NOT NULL,
    "no_retur" VARCHAR(50) NOT NULL,
    "po_id" UUID NOT NULL,
    "reason_code" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "tgl_retur" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_purchase_return_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_purchase_return_d" (
    "id" UUID NOT NULL,
    "retur_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_purchase_return_d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_purchase_invoice" (
    "id" UUID NOT NULL,
    "no_invoice" VARCHAR(50) NOT NULL,
    "po_id" UUID NOT NULL,
    "tgl_invoice" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tgl_jatuh_tempo" TIMESTAMP(3) NOT NULL,
    "total_tagihan" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'UNPAID',
    "user_id" UUID,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_purchase_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_cashier_shift" (
    "id" UUID NOT NULL,
    "no_shift" VARCHAR(50) NOT NULL,
    "user_id" UUID NOT NULL,
    "modal_awal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "modal_akhir" DECIMAL(18,2),
    "saldo_fisik" DECIMAL(18,2),
    "selisih" DECIMAL(18,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_cashier_shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_pos_order" (
    "id" UUID NOT NULL,
    "no_struk" VARCHAR(50) NOT NULL,
    "shift_id" UUID,
    "user_id" UUID NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "bayar" DECIMAL(18,2) NOT NULL,
    "kembalian" DECIMAL(18,2) NOT NULL,
    "metode_bayar" VARCHAR(20) NOT NULL DEFAULT 'TUNAI',
    "status" VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_pos_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_pos_order_d" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "harga_satuan" DECIMAL(18,2) NOT NULL,
    "diskon" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_pos_order_d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_pos_hold" (
    "id" UUID NOT NULL,
    "hold_number" VARCHAR(50) NOT NULL,
    "user_id" UUID NOT NULL,
    "items_json" JSONB NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_pos_hold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_pos_return" (
    "id" UUID NOT NULL,
    "no_retur" VARCHAR(50) NOT NULL,
    "order_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "tgl_retur" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_pos_return_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "t_pos_return_d" (
    "id" UUID NOT NULL,
    "retur_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_pos_return_d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_store_setting" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_store_setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "m_item_barcode_key" ON "m_item"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "m_item_unit_item_id_unit_name_key" ON "m_item_unit"("item_id", "unit_name");

-- CreateIndex
CREATE UNIQUE INDEX "m_item_rack_item_id_rack_id_key" ON "m_item_rack"("item_id", "rack_id");

-- CreateIndex
CREATE INDEX "t_stock_item_id_location_idx" ON "t_stock"("item_id", "location");

-- CreateIndex
CREATE INDEX "t_stock_card_item_id_tanggal_idx" ON "t_stock_card"("item_id", "tanggal");

-- CreateIndex
CREATE UNIQUE INDEX "t_stock_mutation_no_mutasi_key" ON "t_stock_mutation"("no_mutasi");

-- CreateIndex
CREATE UNIQUE INDEX "t_stock_opname_no_opname_key" ON "t_stock_opname"("no_opname");

-- CreateIndex
CREATE UNIQUE INDEX "t_stock_adjustment_no_adjustment_key" ON "t_stock_adjustment"("no_adjustment");

-- CreateIndex
CREATE UNIQUE INDEX "m_supplier_kode_supplier_key" ON "m_supplier"("kode_supplier");

-- CreateIndex
CREATE UNIQUE INDEX "m_supplier_price_supplier_id_item_id_key" ON "m_supplier_price"("supplier_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "t_purchase_order_no_po_key" ON "t_purchase_order"("no_po");

-- CreateIndex
CREATE UNIQUE INDEX "t_goods_receipt_no_gr_key" ON "t_goods_receipt"("no_gr");

-- CreateIndex
CREATE UNIQUE INDEX "t_purchase_return_no_retur_key" ON "t_purchase_return"("no_retur");

-- CreateIndex
CREATE UNIQUE INDEX "t_purchase_invoice_no_invoice_key" ON "t_purchase_invoice"("no_invoice");

-- CreateIndex
CREATE UNIQUE INDEX "t_purchase_invoice_po_id_key" ON "t_purchase_invoice"("po_id");

-- CreateIndex
CREATE UNIQUE INDEX "t_cashier_shift_no_shift_key" ON "t_cashier_shift"("no_shift");

-- CreateIndex
CREATE UNIQUE INDEX "t_pos_order_no_struk_key" ON "t_pos_order"("no_struk");

-- CreateIndex
CREATE UNIQUE INDEX "t_pos_hold_hold_number_key" ON "t_pos_hold"("hold_number");

-- CreateIndex
CREATE UNIQUE INDEX "t_pos_return_no_retur_key" ON "t_pos_return"("no_retur");

-- CreateIndex
CREATE UNIQUE INDEX "m_store_setting_key_key" ON "m_store_setting"("key");

-- AddForeignKey
ALTER TABLE "m_item" ADD CONSTRAINT "m_item_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "m_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_item_unit" ADD CONSTRAINT "m_item_unit_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_item_rack" ADD CONSTRAINT "m_item_rack_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_item_rack" ADD CONSTRAINT "m_item_rack_rack_id_fkey" FOREIGN KEY ("rack_id") REFERENCES "m_rack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_stock" ADD CONSTRAINT "t_stock_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_stock_card" ADD CONSTRAINT "t_stock_card_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_stock_mutation_d" ADD CONSTRAINT "t_stock_mutation_d_mutation_id_fkey" FOREIGN KEY ("mutation_id") REFERENCES "t_stock_mutation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_stock_opname_d" ADD CONSTRAINT "t_stock_opname_d_opname_id_fkey" FOREIGN KEY ("opname_id") REFERENCES "t_stock_opname"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_stock_adjustment_d" ADD CONSTRAINT "t_stock_adjustment_d_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "t_stock_adjustment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_supplier_price" ADD CONSTRAINT "m_supplier_price_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "m_supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_purchase_order" ADD CONSTRAINT "t_purchase_order_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "m_supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_purchase_order_d" ADD CONSTRAINT "t_purchase_order_d_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "t_purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_purchase_order_d" ADD CONSTRAINT "t_purchase_order_d_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_goods_receipt" ADD CONSTRAINT "t_goods_receipt_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "t_purchase_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_goods_receipt_d" ADD CONSTRAINT "t_goods_receipt_d_gr_id_fkey" FOREIGN KEY ("gr_id") REFERENCES "t_goods_receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_goods_receipt_d" ADD CONSTRAINT "t_goods_receipt_d_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_purchase_return" ADD CONSTRAINT "t_purchase_return_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "t_purchase_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_purchase_return_d" ADD CONSTRAINT "t_purchase_return_d_retur_id_fkey" FOREIGN KEY ("retur_id") REFERENCES "t_purchase_return"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_purchase_invoice" ADD CONSTRAINT "t_purchase_invoice_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "t_purchase_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_pos_order" ADD CONSTRAINT "t_pos_order_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "t_cashier_shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_pos_order_d" ADD CONSTRAINT "t_pos_order_d_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "t_pos_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_pos_order_d" ADD CONSTRAINT "t_pos_order_d_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_pos_return" ADD CONSTRAINT "t_pos_return_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "t_pos_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_pos_return_d" ADD CONSTRAINT "t_pos_return_d_retur_id_fkey" FOREIGN KEY ("retur_id") REFERENCES "t_pos_return"("id") ON DELETE CASCADE ON UPDATE CASCADE;
