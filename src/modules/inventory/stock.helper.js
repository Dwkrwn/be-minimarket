import { fail } from "../../core/utils/helpers.js";

export const ITEM_SELECT = {
  id: true,
  barcode: true,
  nama_barang: true,
  base_unit: true,
};

/**
 * Helper stok bersama untuk inventory, purchasing, dan POS.
 * Semua fungsi menerima `tx` sehingga wajib dipanggil di dalam securityTransaction.
 */

export async function sumStock(tx, itemId, location) {
  const result = await tx.t_stock.aggregate({
    where: { item_id: itemId, location },
    _sum: { qty: true },
  });
  return result._sum.qty || 0;
}

export async function addStock(
  tx,
  { itemId, location, qty, batchNumber = null, expiredDate = null },
) {
  if (qty <= 0) return;

  const existing = await tx.t_stock.findFirst({
    where: {
      item_id: itemId,
      location,
      batch_number: batchNumber,
      expired_date: expiredDate,
    },
  });

  if (existing) {
    await tx.t_stock.update({
      where: { id: existing.id },
      data: { qty: { increment: qty } },
    });
  } else {
    await tx.t_stock.create({
      data: {
        item_id: itemId,
        location,
        qty,
        batch_number: batchNumber,
        expired_date: expiredDate,
      },
    });
  }
}

export async function writeCard(
  tx,
  {
    itemId,
    location,
    mutationType,
    qtyIn = 0,
    qtyOut = 0,
    referenceNo,
    userId,
    note,
  },
) {
  const balance = await sumStock(tx, itemId, location);
  await tx.t_stock_card.create({
    data: {
      item_id: itemId,
      location,
      jenis_mutasi: mutationType,
      qty_in: qtyIn,
      qty_out: qtyOut,
      saldo_akhir: balance,
      no_dokumen: referenceNo,
      user_id: userId,
      keterangan: note,
    },
  });
}

export async function assertItemExists(tx, itemId) {
  const item = await tx.m_item.findUnique({ where: { id: itemId } });
  if (!item) fail(404, `Barang ${itemId} tidak ditemukan`);
  return item;
}

/**
 * Mengurangi stok memakai urutan FEFO (First Expired First Out).
 * Stok dianggap tidak cukup jika total seluruh lot < qty (anti-minus stok).
 */
export async function removeStockFEFO(
  tx,
  { itemId, location, qty, mutationType, referenceNo, userId, note },
) {
  const lots = await tx.t_stock.findMany({
    where: { item_id: itemId, location, qty: { gt: 0 } },
    orderBy: [{ expired_date: "asc" }, { createdAt: "asc" }],
  });

  const available = lots.reduce((sum, lot) => sum + lot.qty, 0);
  if (available < qty) {
    const item = await assertItemExists(tx, itemId);
    fail(
      409,
      `Stok ${item.nama_barang} di ${location} tidak cukup (tersedia ${available}, dibutuhkan ${qty})`,
    );
  }

  let remaining = qty;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qty, remaining);
    await tx.t_stock.update({
      where: { id: lot.id },
      data: { qty: { decrement: take } },
    });
    remaining -= take;
  }

  await writeCard(tx, {
    itemId,
    location,
    mutationType,
    qtyOut: qty,
    referenceNo,
    userId,
    note,
  });
}

export async function moveStockLots(
  tx,
  { itemId, fromLocation, toLocation, qty, referenceNo, userId, note },
) {
  const lots = await tx.t_stock.findMany({
    where: { item_id: itemId, location: fromLocation, qty: { gt: 0 } },
    orderBy: [{ expired_date: "asc" }, { createdAt: "asc" }],
  });

  const available = lots.reduce((sum, lot) => sum + lot.qty, 0);
  if (available < qty) {
    const item = await assertItemExists(tx, itemId);
    fail(
      409,
      `Stok ${item.nama_barang} di ${fromLocation} tidak cukup (tersedia ${available}, dibutuhkan ${qty})`,
    );
  }

  let remaining = qty;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qty, remaining);
    await tx.t_stock.update({
      where: { id: lot.id },
      data: { qty: { decrement: take } },
    });
    await addStock(tx, {
      itemId,
      location: toLocation,
      qty: take,
      batchNumber: lot.batch_number,
      expiredDate: lot.expired_date,
    });
    remaining -= take;
  }

  await writeCard(tx, {
    itemId,
    location: fromLocation,
    mutationType: "MOVE_SHELF",
    qtyOut: qty,
    referenceNo,
    userId,
    note,
  });
  await writeCard(tx, {
    itemId,
    location: toLocation,
    mutationType: "MOVE_SHELF",
    qtyIn: qty,
    referenceNo,
    userId,
    note,
  });
}
