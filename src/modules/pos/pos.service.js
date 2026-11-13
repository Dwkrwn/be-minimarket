import prisma from "../../config/database.js";
import { fail, isManager } from "../../core/utils/helpers.js";
import { securityTransaction } from "../../core/utils/securityTx.js";
import { nextDocumentNumber } from "../../core/utils/documentNumber.js";
import {
  parseListQuery,
  paginationMeta,
  parseDateRange,
} from "../../core/utils/query.js";
import { validate } from "../../core/utils/validation.js";
import {
  ITEM_SELECT,
  assertItemExists,
  addStock,
  removeStockFEFO,
  writeCard,
} from "../inventory/stock.helper.js";
import {
  openShiftSchema,
  closeShiftSchema,
  checkoutSchema,
  holdSchema,
  voidOrderSchema,
  posReturnSchema,
  rejectReturnSchema,
  settingsSchema,
} from "./pos.validation.js";

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const toNumber = (value) => (value == null ? 0 : Number(value));

const DEFAULT_SETTINGS = {
  "store.name": "Minimarket",
  "store.address": "",
  "store.phone": "",
  "pos.return_enabled": "false",
  "pos.require_shift": "true",
  "pos.receipt_footer": "Terima kasih telah berbelanja",
};

const orderInclude = {
  shift: true,
  details: { include: { item: { select: ITEM_SELECT } } },
  returns: { include: { details: true } },
};

/* ==========================================================================
 * PENGATURAN TOKO
 * ========================================================================== */

export async function getSettingsMap() {
  const rows = await prisma.m_store_setting.findMany({
    where: { is_active: true },
  });
  return {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(rows.map((row) => [row.key, row.value ?? ""])),
  };
}

export async function listSettingsService() {
  const rows = await prisma.m_store_setting.findMany({
    orderBy: { key: "asc" },
  });
  return {
    data: rows,
    values: await getSettingsMap(),
  };
}

export async function saveSettingsService(body) {
  const value = validate(settingsSchema, body);

  return securityTransaction(async (tx) => {
    const saved = [];
    for (const setting of value.settings) {
      saved.push(
        await tx.m_store_setting.upsert({
          where: { key: setting.key },
          update: {
            value: setting.value ?? null,
            description: setting.description ?? null,
            is_active: setting.is_active,
          },
          create: {
            key: setting.key,
            value: setting.value ?? null,
            description: setting.description ?? null,
            is_active: setting.is_active,
          },
        }),
      );
    }
    return saved;
  });
}

async function featureEnabled(key, fallback = false) {
  const setting = await prisma.m_store_setting.findUnique({ where: { key } });
  if (!setting || !setting.is_active) return fallback;
  return setting.value === "true";
}

/* ==========================================================================
 * PRODUK UNTUK KASIR
 * ========================================================================== */

export async function listProductsService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["nama_barang", "barcode", "harga_jual", "createdAt"],
  });

  const where = { is_active: true };
  if (query.category_id) where.category_id = query.category_id;
  if (parsed.search) {
    where.OR = [
      { barcode: { contains: parsed.search, mode: "insensitive" } },
      { nama_barang: { contains: parsed.search, mode: "insensitive" } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.m_item.count({ where }),
    prisma.m_item.findMany({
      where,
      include: { stocks: true, units: true, category: true },
      orderBy: [{ [parsed.order]: parsed.direction }, { id: "asc" }],
      ...(parsed.all
        ? {}
        : { skip: (parsed.page - 1) * parsed.limit, take: parsed.limit }),
    }),
  ]);

  const data = items.map((item) => ({
    id: item.id,
    barcode: item.barcode,
    nama_barang: item.nama_barang,
    base_unit: item.base_unit,
    harga_jual: item.harga_jual,
    harga_modal: item.harga_modal,
    kategori: item.category?.name || null,
    units: item.units,
    shelf_stock: item.stocks
      .filter((stock) => stock.location === "SHELF")
      .reduce((sum, stock) => sum + stock.qty, 0),
  }));

  return {
    data,
    pagination: paginationMeta(
      total,
      parsed.page,
      parsed.limit,
      data.length,
      parsed.all,
    ),
  };
}

/* ==========================================================================
 * SHIFT KASIR (buka / tutup blind closing)
 * ========================================================================== */

export async function listShiftsService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["opened_at", "closed_at", "createdAt", "no_shift"],
  });
  const { from, to } = parseDateRange(query);

  const where = {};
  if (query.status) where.status = query.status;
  if (query.user_id) where.user_id = query.user_id;
  if (from || to) {
    where.opened_at = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  if (parsed.search) {
    where.no_shift = { contains: parsed.search, mode: "insensitive" };
  }

  const [total, data] = await Promise.all([
    prisma.t_cashier_shift.count({ where }),
    prisma.t_cashier_shift.findMany({
      where,
      include: { _count: { select: { orders: true } } },
      orderBy: [{ [parsed.order]: parsed.direction }, { id: "asc" }],
      ...(parsed.all
        ? {}
        : { skip: (parsed.page - 1) * parsed.limit, take: parsed.limit }),
    }),
  ]);

  return {
    data,
    pagination: paginationMeta(
      total,
      parsed.page,
      parsed.limit,
      data.length,
      parsed.all,
    ),
  };
}

async function computeShiftTotals(tx, shiftId) {
  const orders = await tx.t_pos_order.findMany({
    where: { shift_id: shiftId, status: "COMPLETED" },
    select: { metode_bayar: true, total_amount: true, bayar: true, kembalian: true },
  });

  const byMethod = {};
  for (const order of orders) {
    byMethod[order.metode_bayar] =
      (byMethod[order.metode_bayar] || 0) + toNumber(order.total_amount);
  }

  const cashSales = byMethod.TUNAI || 0;
  const totalSales = orders.reduce(
    (sum, order) => sum + toNumber(order.total_amount),
    0,
  );

  const returns = await tx.t_pos_return.findMany({
    where: {
      status: "COMPLETED",
      order: { shift_id: shiftId },
    },
    select: {
      details: { select: { item_id: true, qty: true } },
      order: { select: { details: true } },
    },
  });

  // Retur mengurangi omzet tunai sesuai nilai barang yang dikembalikan.
  let returnValue = 0;
  for (const retur of returns) {
    for (const line of retur.details) {
      const orderLine = retur.order.details.find((d) => d.item_id === line.item_id);
      if (orderLine) {
        returnValue += line.qty * toNumber(orderLine.harga_satuan);
      }
    }
  }

  return {
    transaction_count: orders.length,
    gross_sales: round2(totalSales),
    total_sales: round2(totalSales - returnValue),
    by_method: Object.fromEntries(
      Object.entries(byMethod).map(([key, value]) => [key, round2(value)]),
    ),
    cash_sales: round2(cashSales),
    return_count: returns.length,
    return_value: round2(returnValue),
  };
}

export async function getShiftService(id) {
  const shift = await prisma.t_cashier_shift.findUnique({ where: { id } });
  if (!shift) fail(404, "Shift tidak ditemukan");
  const totals = await computeShiftTotals(prisma, id);
  return { ...shift, totals };
}

export async function getShiftSummaryService(id) {
  const shift = await prisma.t_cashier_shift.findUnique({ where: { id } });
  if (!shift) fail(404, "Shift tidak ditemukan");
  const totals = await computeShiftTotals(prisma, id);
  const expectedCash = round2(
    toNumber(shift.modal_awal) + totals.cash_sales - totals.return_value,
  );
  return {
    shift,
    totals,
    expected_cash: expectedCash,
  };
}

export async function openShiftService(body, userId) {
  const value = validate(openShiftSchema, body);

  return securityTransaction(async (tx) => {
    const open = await tx.t_cashier_shift.findFirst({
      where: { user_id: userId, status: "OPEN" },
    });
    if (open) {
      fail(409, `Anda masih memiliki shift terbuka (${open.no_shift})`);
    }

    const noShift = await nextDocumentNumber(tx, {
      model: "t_cashier_shift",
      field: "no_shift",
      prefix: "SHF",
      period: "day",
    });

    return tx.t_cashier_shift.create({
      data: {
        no_shift: noShift,
        user_id: userId,
        modal_awal: value.modal_awal,
        status: "OPEN",
        catatan: value.catatan,
      },
    });
  });
}

export async function closeShiftService(id, body, actor) {
  const value = validate(closeShiftSchema, body);
  const userId = actor.id;

  return securityTransaction(async (tx) => {
    const shift = await tx.t_cashier_shift.findUnique({ where: { id } });
    if (!shift) fail(404, "Shift tidak ditemukan");
    if (shift.user_id !== userId && !isManager(actor)) {
      fail(403, "Anda hanya dapat menutup shift milik sendiri");
    }
    if (shift.status !== "OPEN") fail(409, "Shift sudah ditutup");

    const totals = await computeShiftTotals(tx, id);
    const expectedCash = round2(
      toNumber(shift.modal_awal) + totals.cash_sales - totals.return_value,
    );
    const saldoFisik = round2(value.saldo_fisik);
    const selisih = round2(saldoFisik - expectedCash);

    const updated = await tx.t_cashier_shift.update({
      where: { id },
      data: {
        status: "CLOSED",
        closed_at: new Date(),
        modal_akhir: expectedCash,
        saldo_fisik: saldoFisik,
        selisih,
        catatan: value.catatan || shift.catatan,
      },
    });

    return {
      shift: updated,
      totals,
      expected_cash: expectedCash,
      saldo_fisik: saldoFisik,
      selisih,
      selisih_status:
        selisih === 0 ? "PAS" : selisih > 0 ? "LEBIH" : "KURANG",
    };
  });
}

/* ==========================================================================
 * CHECKOUT POS
 * ========================================================================== */

async function buildOrderLines(tx, items) {
  const lineItems = [];
  for (const entry of items) {
    const item = await assertItemExists(tx, entry.item_id);
    if (!item.is_active) fail(409, `Barang ${item.nama_barang} tidak aktif`);

    const harga = entry.harga_satuan == null
      ? toNumber(item.harga_jual)
      : toNumber(entry.harga_satuan);
    if (harga < 0) fail(400, "Harga tidak valid");

    const gross = round2(harga * entry.qty);
    const diskon = round2(entry.diskon || 0);
    if (diskon > gross) fail(400, `Diskon ${item.nama_barang} melebihi subtotal`);

    lineItems.push({
      item,
      item_id: item.id,
      qty: entry.qty,
      harga_satuan: harga,
      diskon,
      subtotal: round2(gross - diskon),
    });
  }
  return lineItems;
}

async function resolveShift(tx, userId) {
  const requireShift = await featureEnabled("pos.require_shift", true);

  const shift = await tx.t_cashier_shift.findFirst({
    where: { user_id: userId, status: "OPEN" },
  });

  if (requireShift && !shift) {
    fail(409, "Buka shift terlebih dahulu sebelum melakukan transaksi");
  }

  return shift;
}

export async function checkoutService(body, userId) {
  const value = validate(checkoutSchema, body);

  return securityTransaction(async (tx) => {
    const shift = await resolveShift(tx, userId);
    const lines = await buildOrderLines(tx, value.items);

    const total = round2(
      lines.reduce((sum, line) => sum + line.subtotal, 0),
    );

    const bayar = round2(value.bayar);
    if (bayar < total) {
      fail(409, `Pembayaran kurang. Total ${total}, dibayar ${bayar}`);
    }

    const noStruk = await nextDocumentNumber(tx, {
      model: "t_pos_order",
      field: "no_struk",
      prefix: "POS",
      period: "day",
    });

    const order = await tx.t_pos_order.create({
      data: {
        no_struk: noStruk,
        shift_id: shift?.id || null,
        user_id: userId,
        total_amount: total,
        bayar,
        kembalian: round2(bayar - total),
        metode_bayar: value.metode_bayar,
        status: "COMPLETED",
        catatan: value.catatan,
        details: {
          create: lines.map((line) => ({
            item_id: line.item_id,
            qty: line.qty,
            harga_satuan: line.harga_satuan,
            diskon: line.diskon,
            subtotal: line.subtotal,
          })),
        },
      },
    });

    for (const line of lines) {
      await removeStockFEFO(tx, {
        itemId: line.item_id,
        location: "SHELF",
        qty: line.qty,
        mutationType: "OUT_POS",
        referenceNo: noStruk,
        userId,
        note: `Penjualan kasir ${value.metode_bayar}`,
      });
    }

    return tx.t_pos_order.findUnique({
      where: { id: order.id },
      include: orderInclude,
    });
  });
}

export async function listOrdersService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["createdAt", "no_struk", "total_amount"],
  });
  const { from, to } = parseDateRange(query);

  const where = {};
  if (query.status) where.status = query.status;
  if (query.shift_id) where.shift_id = query.shift_id;
  if (query.user_id) where.user_id = query.user_id;
  if (query.metode_bayar) where.metode_bayar = query.metode_bayar;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  if (parsed.search) {
    where.no_struk = { contains: parsed.search, mode: "insensitive" };
  }

  const [total, data] = await Promise.all([
    prisma.t_pos_order.count({ where }),
    prisma.t_pos_order.findMany({
      where,
      include: orderInclude,
      orderBy: [{ [parsed.order]: parsed.direction }, { id: "asc" }],
      ...(parsed.all
        ? {}
        : { skip: (parsed.page - 1) * parsed.limit, take: parsed.limit }),
    }),
  ]);

  return {
    data,
    pagination: paginationMeta(
      total,
      parsed.page,
      parsed.limit,
      data.length,
      parsed.all,
    ),
  };
}

export async function getOrderService(id) {
  const order = await prisma.t_pos_order.findUnique({
    where: { id },
    include: orderInclude,
  });
  if (!order) fail(404, "Transaksi tidak ditemukan");
  return order;
}

export async function getReceiptService(id) {
  const order = await prisma.t_pos_order.findUnique({
    where: { id },
    include: orderInclude,
  });
  if (!order) fail(404, "Transaksi tidak ditemukan");

  const settings = await getSettingsMap();
  return {
    store: {
      name: settings["store.name"],
      address: settings["store.address"],
      phone: settings["store.phone"],
    },
    footer: settings["pos.receipt_footer"],
    return_enabled: settings["pos.return_enabled"] === "true",
    order,
  };
}

export async function voidOrderService(id, body, userId) {
  const value = validate(voidOrderSchema, body);

  return securityTransaction(async (tx) => {
    const order = await tx.t_pos_order.findUnique({
      where: { id },
      include: {
        details: true,
        returns: { include: { details: true } },
      },
    });
    if (!order) fail(404, "Transaksi tidak ditemukan");
    if (order.status !== "COMPLETED") {
      fail(409, "Hanya transaksi COMPLETED yang dapat di-void");
    }
    if (order.returns.some((retur) => retur.status === "PENDING")) {
      fail(409, "Transaksi masih memiliki retur yang menunggu persetujuan");
    }

    const returnedByItem = new Map();
    for (const retur of order.returns) {
      if (retur.status !== "COMPLETED") continue;
      for (const line of retur.details) {
        returnedByItem.set(
          line.item_id,
          (returnedByItem.get(line.item_id) || 0) + line.qty,
        );
      }
    }

    for (const line of order.details) {
      const alreadyReturned = returnedByItem.get(line.item_id) || 0;
      const qty = line.qty - alreadyReturned;
      if (qty <= 0) continue;

      await addStock(tx, {
        itemId: line.item_id,
        location: "SHELF",
        qty,
      });
      await writeCard(tx, {
        itemId: line.item_id,
        location: "SHELF",
        mutationType: "IN_VOID",
        qtyIn: qty,
        referenceNo: order.no_struk,
        userId,
        note: `Void transaksi: ${value.catatan}`,
      });
    }

    return tx.t_pos_order.update({
      where: { id },
      data: { status: "VOID", catatan: value.catatan },
      include: orderInclude,
    });
  });
}

/* ==========================================================================
 * HOLD / RESUME
 * ========================================================================== */

export async function createHoldService(body, userId) {
  const value = validate(holdSchema, body);

  return securityTransaction(async (tx) => {
    const lines = await buildOrderLines(tx, value.items);
    const total = round2(lines.reduce((sum, line) => sum + line.subtotal, 0));

    const holdNumber = await nextDocumentNumber(tx, {
      model: "t_pos_hold",
      field: "hold_number",
      prefix: "HLD",
      period: "day",
    });

    return tx.t_pos_hold.create({
      data: {
        hold_number: holdNumber,
        user_id: userId,
        total_amount: total,
        items_json: lines.map((line) => ({
          item_id: line.item_id,
          barcode: line.item.barcode,
          nama_barang: line.item.nama_barang,
          base_unit: line.item.base_unit,
          qty: line.qty,
          harga_satuan: line.harga_satuan,
          diskon: line.diskon,
          subtotal: line.subtotal,
        })),
      },
    });
  });
}

export async function listHoldsService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["createdAt", "hold_number", "total_amount"],
  });

  const where = {};
  if (query.user_id) where.user_id = query.user_id;
  if (parsed.search) {
    where.hold_number = { contains: parsed.search, mode: "insensitive" };
  }

  const [total, data] = await Promise.all([
    prisma.t_pos_hold.count({ where }),
    prisma.t_pos_hold.findMany({
      where,
      orderBy: [{ [parsed.order]: parsed.direction }, { id: "asc" }],
      ...(parsed.all
        ? {}
        : { skip: (parsed.page - 1) * parsed.limit, take: parsed.limit }),
    }),
  ]);

  return {
    data,
    pagination: paginationMeta(
      total,
      parsed.page,
      parsed.limit,
      data.length,
      parsed.all,
    ),
  };
}

export async function takeHoldService(id, userId) {
  return securityTransaction(async (tx) => {
    const hold = await tx.t_pos_hold.findUnique({ where: { id } });
    if (!hold) fail(404, "Data hold tidak ditemukan");

    await tx.t_pos_hold.delete({ where: { id } });
    return { ...hold, resumed_by: userId };
  });
}

export async function deleteHoldService(id) {
  const hold = await prisma.t_pos_hold.findUnique({ where: { id } });
  if (!hold) fail(404, "Data hold tidak ditemukan");
  await prisma.t_pos_hold.delete({ where: { id } });
}

/* ==========================================================================
 * RETUR PENJUALAN (opsional via m_store_setting)
 * ========================================================================== */

const posReturnInclude = {
  order: { include: { details: true } },
  details: true,
};

export async function listPosReturnsService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["tgl_retur", "no_retur", "createdAt"],
  });
  const { from, to } = parseDateRange(query);

  const where = {};
  if (query.status) where.status = query.status;
  if (query.order_id) where.order_id = query.order_id;
  if (from || to) {
    where.tgl_retur = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  if (parsed.search) {
    where.no_retur = { contains: parsed.search, mode: "insensitive" };
  }

  const [total, data] = await Promise.all([
    prisma.t_pos_return.count({ where }),
    prisma.t_pos_return.findMany({
      where,
      include: posReturnInclude,
      orderBy: [{ [parsed.order]: parsed.direction }, { id: "asc" }],
      ...(parsed.all
        ? {}
        : { skip: (parsed.page - 1) * parsed.limit, take: parsed.limit }),
    }),
  ]);

  return {
    data: await Promise.all(
      data.map(async (retur) => ({
        ...retur,
        details: await enrichPosReturnDetails(retur),
      })),
    ),
    pagination: paginationMeta(
      total,
      parsed.page,
      parsed.limit,
      data.length,
      parsed.all,
    ),
  };
}

async function enrichPosReturnDetails(retur) {
  const ids = [...new Set(retur.details.map((line) => line.item_id))];
  if (!ids.length) return retur.details;
  const items = await prisma.m_item.findMany({
    where: { id: { in: ids } },
    select: ITEM_SELECT,
  });
  const map = new Map(items.map((item) => [item.id, item]));
  return retur.details.map((line) => ({
    ...line,
    item: map.get(line.item_id) || null,
  }));
}

export async function getPosReturnService(id) {
  const data = await prisma.t_pos_return.findUnique({
    where: { id },
    include: posReturnInclude,
  });
  if (!data) fail(404, "Retur penjualan tidak ditemukan");
  return { ...data, details: await enrichPosReturnDetails(data) };
}

export async function createPosReturnService(body, userId) {
  if (!(await featureEnabled("pos.return_enabled", false))) {
    fail(409, "Fitur retur penjualan sedang dinonaktifkan");
  }
  const value = validate(posReturnSchema, body);

  return securityTransaction(async (tx) => {
    const order = await tx.t_pos_order.findUnique({
      where: { id: value.order_id },
      include: {
        details: true,
        returns: { include: { details: true } },
      },
    });
    if (!order) fail(404, "Transaksi tidak ditemukan");
    if (order.status !== "COMPLETED") {
      fail(409, "Retur hanya untuk transaksi COMPLETED");
    }

    const boughtByItem = new Map(
      order.details.map((line) => [line.item_id, line.qty]),
    );
    const returnedByItem = new Map();
    for (const retur of order.returns) {
      if (retur.status === "REJECT") continue;
      for (const line of retur.details) {
        returnedByItem.set(
          line.item_id,
          (returnedByItem.get(line.item_id) || 0) + line.qty,
        );
      }
    }

    for (const line of value.items) {
      const bought = boughtByItem.get(line.item_id);
      if (!bought) fail(400, "Barang retur tidak ada pada transaksi");
      const returned = returnedByItem.get(line.item_id) || 0;
      if (returned + line.qty > bought) {
        fail(
          409,
          `Qty retur melebihi qty pembelian untuk barang ${line.item_id} (dibeli ${bought}, sudah diretur ${returned})`,
        );
      }
    }

    const noRetur = await nextDocumentNumber(tx, {
      model: "t_pos_return",
      field: "no_retur",
      prefix: "RTS",
      period: "day",
    });

    return tx.t_pos_return.create({
      data: {
        no_retur: noRetur,
        order_id: order.id,
        status: "PENDING",
        user_id: userId,
        catatan: value.catatan,
        details: { create: value.items },
      },
      include: posReturnInclude,
    });
  });
}

export async function approvePosReturnService(id, userId) {
  return securityTransaction(async (tx) => {
    const retur = await tx.t_pos_return.findUnique({
      where: { id },
      include: { order: { include: { details: true } }, details: true },
    });
    if (!retur) fail(404, "Retur penjualan tidak ditemukan");
    if (retur.status !== "PENDING") {
      fail(409, "Hanya retur PENDING yang dapat disetujui");
    }

    for (const line of retur.details) {
      await addStock(tx, {
        itemId: line.item_id,
        location: "SHELF",
        qty: line.qty,
      });
      await writeCard(tx, {
        itemId: line.item_id,
        location: "SHELF",
        mutationType: "IN_RETURN",
        qtyIn: line.qty,
        referenceNo: retur.no_retur,
        userId,
        note: `Retur penjualan ${retur.order.no_struk}`,
      });
    }

    return tx.t_pos_return.update({
      where: { id },
      data: {
        status: "COMPLETED",
        approved_by: userId,
        approved_at: new Date(),
      },
      include: posReturnInclude,
    });
  });
}

export async function rejectPosReturnService(id, body, userId) {
  const value = validate(rejectReturnSchema, body);

  return securityTransaction(async (tx) => {
    const retur = await tx.t_pos_return.findUnique({ where: { id } });
    if (!retur) fail(404, "Retur penjualan tidak ditemukan");
    if (retur.status !== "PENDING") {
      fail(409, "Hanya retur PENDING yang dapat ditolak");
    }

    return tx.t_pos_return.update({
      where: { id },
      data: {
        status: "REJECT",
        approved_by: userId,
        approved_at: new Date(),
        catatan: value.catatan,
      },
      include: posReturnInclude,
    });
  });
}

/* ==========================================================================
 * LAPORAN
 * ========================================================================== */

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export async function salesReportService(query = {}) {
  const now = new Date();
  const from = query.from ? new Date(query.from) : startOfDay(now);
  const to = query.to ? new Date(query.to) : endOfDay(now);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    fail(400, "Rentang tanggal tidak valid");
  }
  if (from > to) fail(400, "Tanggal awal tidak boleh melebihi tanggal akhir");

  const itemSelect = {
    id: true,
    barcode: true,
    nama_barang: true,
    harga_modal: true,
  };

  const orders = await prisma.t_pos_order.findMany({
    where: {
      status: "COMPLETED",
      createdAt: { gte: from, lte: to },
    },
    include: { details: { include: { item: { select: itemSelect } } } },
    orderBy: { createdAt: "asc" },
  });

  const returns = await prisma.t_pos_return.findMany({
    where: {
      status: "COMPLETED",
      tgl_retur: { gte: from, lte: to },
    },
    include: {
      details: true,
      order: { include: { details: true } },
    },
    orderBy: { tgl_retur: "asc" },
  });

  const dailyMap = new Map();
  const paymentMap = new Map();
  const itemMap = new Map();
  const modalByItem = new Map();
  let totalSales = 0;
  let totalQty = 0;
  let totalCost = 0;

  for (const order of orders) {
    const day = startOfDay(order.createdAt).toISOString().slice(0, 10);
    totalSales += toNumber(order.total_amount);

    paymentMap.set(
      order.metode_bayar,
      (paymentMap.get(order.metode_bayar) || 0) + toNumber(order.total_amount),
    );

    const daily = dailyMap.get(day) || { date: day, total: 0, transactions: 0 };
    daily.total += toNumber(order.total_amount);
    daily.transactions += 1;
    dailyMap.set(day, daily);

    for (const line of order.details) {
      totalQty += line.qty;
      const modal = toNumber(line.item?.harga_modal);
      modalByItem.set(line.item_id, modal);
      totalCost += modal * line.qty;

      const entry = itemMap.get(line.item_id) || {
        item_id: line.item_id,
        barcode: line.item?.barcode || null,
        nama_barang: line.item?.nama_barang || null,
        qty: 0,
        omzet: 0,
      };
      entry.qty += line.qty;
      entry.omzet += toNumber(line.subtotal);
      itemMap.set(line.item_id, entry);
    }
  }

  let returnsTotal = 0;
  let returnsQty = 0;
  let returnsCost = 0;

  for (const retur of returns) {
    const day = startOfDay(retur.tgl_retur).toISOString().slice(0, 10);
    const daily = dailyMap.get(day) || { date: day, total: 0, transactions: 0 };

    for (const line of retur.details) {
      const orderLine = retur.order.details.find(
        (detail) => detail.item_id === line.item_id,
      );
      if (!orderLine) continue;

      const unitValue =
        orderLine.qty > 0
          ? toNumber(orderLine.subtotal) / orderLine.qty
          : toNumber(orderLine.harga_satuan);
      const value = round2(unitValue * line.qty);

      returnsTotal += value;
      returnsQty += line.qty;
      returnsCost += (modalByItem.get(line.item_id) || 0) * line.qty;

      daily.total -= value;

      const entry = itemMap.get(line.item_id);
      if (entry) {
        entry.qty -= line.qty;
        entry.omzet -= value;
      }
    }
    dailyMap.set(day, daily);
  }

  const netSales = round2(totalSales - returnsTotal);
  const netQty = totalQty - returnsQty;
  const netCost = round2(totalCost - returnsCost);

  const bestSellers = [...itemMap.values()]
    .filter((row) => row.qty > 0)
    .map((row) => ({ ...row, omzet: round2(row.omzet) }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, Math.max(Number(query.limit_best_seller || 20), 1));

  return {
    period: { from, to },
    summary: {
      transactions: orders.length,
      gross_sales: round2(totalSales),
      returns_total: round2(returnsTotal),
      returns_qty: returnsQty,
      return_count: returns.length,
      total_sales: netSales,
      total_qty: netQty,
      total_cost: netCost,
      gross_profit: round2(netSales - netCost),
      average_per_transaction: orders.length
        ? round2(netSales / orders.length)
        : 0,
    },
    by_payment: Object.fromEntries(
      [...paymentMap.entries()].map(([key, value]) => [key, round2(value)]),
    ),
    daily: [...dailyMap.values()].map((row) => ({
      ...row,
      total: round2(row.total),
    })),
    best_sellers: bestSellers,
  };
}

export async function shiftSalesReportService(id) {
  const shift = await prisma.t_cashier_shift.findUnique({ where: { id } });
  if (!shift) fail(404, "Shift tidak ditemukan");
  const totals = await computeShiftTotals(prisma, id);

  const orders = await prisma.t_pos_order.findMany({
    where: { shift_id: id, status: "COMPLETED" },
    include: { details: true },
    orderBy: { createdAt: "asc" },
  });

  const itemMap = new Map();
  for (const order of orders) {
    for (const line of order.details) {
      const entry = itemMap.get(line.item_id) || {
        item_id: line.item_id,
        qty: 0,
        omzet: 0,
      };
      entry.qty += line.qty;
      entry.omzet += toNumber(line.subtotal);
      itemMap.set(line.item_id, entry);
    }
  }

  return {
    shift,
    totals,
    expected_cash: round2(
      toNumber(shift.modal_awal) + totals.cash_sales - totals.return_value,
    ),
    items: [...itemMap.values()].map((row) => ({
      ...row,
      omzet: round2(row.omzet),
    })),
  };
}
