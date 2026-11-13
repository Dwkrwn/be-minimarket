// =============================================================================
// PURCHASING - RETUR PEMBELIAN (NOTA POTONG TAGIHAN)
// Validasi retur terhadap PO, GR, dan invoice; dipakai oleh Purchasing 3.2
// maupun temuan barang rusak di Inventory 2.3.
// =============================================================================

import { fail } from "../../../src/core/utils/helpers.js";

export const RETURN_STATUS = Object.freeze({
  ISSUED: "ISSUED",
  MATCHED_INVOICE: "MATCHED_INVOICE",
  CANCELLED: "CANCELLED",
});

// Retur yang masih memotong tagihan (belum dibatalkan).
export const ACTIVE_RETURN_STATUSES = [RETURN_STATUS.ISSUED, RETURN_STATUS.MATCHED_INVOICE];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sumReceivedGoodPcs(po, item_id) {
  let total = 0;
  for (const receipt of po?.goods_receipts || []) {
    for (const detail of receipt.details || []) {
      if (detail.item_id === item_id) total += Number(detail.qty_bagus_pcs) || 0;
    }
  }
  return total;
}

export function sumReturnedPcs(po, item_id, { excludeReturnId } = {}) {
  let total = 0;
  for (const retur of po?.purchase_returns || []) {
    if (!ACTIVE_RETURN_STATUSES.includes(retur.status)) continue;
    if (excludeReturnId && retur.id === excludeReturnId) continue;
    for (const detail of retur.details || []) {
      if (detail.item_id === item_id) total += Number(detail.qty_pcs) || 0;
    }
  }
  return total;
}

/**
 * Memastikan retur sah terhadap PO (P1 #6):
 *  - barang harus ada di PO
 *  - PO tidak boleh CANCELLED
 *  - invoice PO belum boleh terbit (nominal tagihan sudah dikunci)
 *  - qty retur kumulatif tidak boleh melebihi barang bagus yang benar-benar diterima
 *
 * @returns {{ poDetail: object, received: number, returned: number, remaining: number }}
 */
export function assertReturnAllowed({ po, item_id, qty_pcs, invoice = null }) {
  const qty = Number(qty_pcs);
  if (!Number.isInteger(qty) || qty <= 0) {
    fail(400, "Kuantitas retur harus bilangan bulat lebih dari 0");
  }

  if (!po) fail(404, "Purchase Order tidak ditemukan");
  if (po.status === "CANCELLED") {
    fail(400, `PO ${po.no_po} sudah dibatalkan, retur tidak dapat dibuat`);
  }

  const poDetail = (po.details || []).find((detail) => detail.item_id === item_id);
  if (!poDetail) {
    fail(400, `Barang tidak terdaftar pada PO ${po.no_po}, retur ditolak`);
  }

  if (invoice) {
    fail(
      400,
      `Invoice PO ${po.no_po} sudah terbit (${invoice.no_invoice}). ` +
        "Nominal tagihan sudah dikunci sehingga retur baru tidak dapat dipotongkan",
    );
  }

  const received = sumReceivedGoodPcs(po, item_id);
  const returned = sumReturnedPcs(po, item_id);
  const remaining = received - returned;

  if (received <= 0) {
    fail(
      400,
      `Belum ada penerimaan barang bagus untuk item ini pada PO ${po.no_po}, retur tidak dapat dibuat`,
    );
  }
  if (qty > remaining) {
    fail(
      400,
      `Kuantitas retur melebihi sisa barang yang diterima. Diterima bagus: ${received} Pcs, ` +
        `Sudah diretur: ${returned} Pcs, Sisa dapat diretur: ${Math.max(0, remaining)} Pcs, ` +
        `Diminta: ${qty} Pcs`,
    );
  }

  return { poDetail, received, returned, remaining };
}

/**
 * Membuat nota retur pembelian beserta validasinya dalam satu transaksi.
 * Dipakai oleh Purchasing 3.2 dan otomatisasi retur dari Inventory 2.3.
 */
export async function issuePurchaseReturn(tx, payload) {
  const { po_id, item_id, qty_pcs, damaged_id = null, user_id = null, catatan, no_retur } = payload;

  if (!po_id) fail(400, "Purchase Order wajib dipilih untuk retur pembelian");
  if (!UUID_PATTERN.test(String(po_id))) fail(400, "Purchase Order tidak valid");
  if (!item_id || !UUID_PATTERN.test(String(item_id))) fail(400, "Barang tidak valid");
  if (damaged_id && !UUID_PATTERN.test(String(damaged_id))) {
    fail(400, "Catatan barang rusak tidak valid");
  }

  const po = await tx.t_purchase_order.findUnique({
    where: { id: po_id },
    include: {
      supplier: true,
      details: true,
      goods_receipts: { include: { details: true } },
      purchase_returns: { include: { details: true } },
    },
  });

  const invoice = po
    ? await tx.t_purchase_invoice.findUnique({ where: { po_id } })
    : null;

  const { poDetail } = assertReturnAllowed({ po, item_id, qty_pcs, invoice });
  const qty = Number(qty_pcs);

  let damaged = null;
  if (damaged_id) {
    damaged = await tx.t_stock_damaged.findUnique({ where: { id: damaged_id } });
    if (!damaged) fail(404, "Catatan barang rusak tidak ditemukan");
    if (damaged.item_id !== item_id) {
      fail(400, "Barang pada catatan rusak berbeda dengan barang yang akan diretur");
    }
    if (qty > Number(damaged.qty_pcs)) {
      fail(
        400,
        `Kuantitas retur melebihi qty barang rusak tercatat (${damaged.qty_pcs} Pcs)`,
      );
    }

    const alreadyUsed = await tx.t_purchase_return.findFirst({
      where: { damaged_id, status: { not: RETURN_STATUS.CANCELLED } },
      select: { no_retur: true },
    });
    if (alreadyUsed) {
      fail(
        409,
        `Catatan barang rusak ${damaged.no_damaged} sudah dipakai pada retur ${alreadyUsed.no_retur}`,
      );
    }
  }

  // Harga potongan mengikuti harga PO (sama dengan perhitungan 3-way matching),
  // bukan harga modal master yang bisa berbeda.
  const harga_satuan_pcs = Number(poDetail.harga_satuan) || 0;
  const total_potongan = qty * harga_satuan_pcs;
  const nomorRetur = no_retur || `RET-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const purchaseReturn = await tx.t_purchase_return.create({
    data: {
      no_retur: nomorRetur,
      po_id: po.id,
      supplier_id: po.supplier_id,
      damaged_id: damaged ? damaged.id : null,
      status: RETURN_STATUS.ISSUED,
      total_potongan,
      user_id,
      catatan:
        catatan ||
        `Nota Potong Tagihan untuk ${qty} Pcs pada PO ${po.no_po}`,
      details: {
        create: [
          {
            item_id,
            qty_pcs: qty,
            harga_satuan_pcs,
            subtotal: total_potongan,
          },
        ],
      },
    },
    include: {
      details: { include: { item: true } },
      supplier: true,
      po: true,
    },
  });

  if (damaged && damaged.status !== "RETURNED_TO_SUPPLIER") {
    await tx.t_stock_damaged.update({
      where: { id: damaged.id },
      data: { status: "RETURNED_TO_SUPPLIER" },
    });
  }

  return purchaseReturn;
}
