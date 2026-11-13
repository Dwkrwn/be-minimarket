import prisma from "../../config/database.js";
import { fail } from "../../core/utils/helpers.js";
import { securityTransaction } from "../../core/utils/securityTx.js";
import { nextDocumentNumber } from "../../core/utils/documentNumber.js";
import {
  parseListQuery,
  paginationMeta,
  parseDateRange,
} from "../../core/utils/query.js";
import { validate } from "../../core/utils/validation.js";
import {
  mutationSchema,
  adjustmentSchema,
  opnameSchema,
  opnameRejectSchema,
} from "./stock.validation.js";

import {
  ITEM_SELECT,
  sumStock,
  addStock,
  writeCard,
  assertItemExists,
  removeStockFEFO,
  moveStockLots,
} from "./stock.helper.js";

export async function listStocksService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["nama_barang", "barcode", "createdAt", "updatedAt"],
  });

  const where = {};
  if (query.item_id) where.id = query.item_id;
  if (query.category_id) where.category_id = query.category_id;
  if (parsed.search) {
    where.OR = ["barcode", "nama_barang"].map((field) => ({
      [field]: { contains: parsed.search, mode: "insensitive" },
    }));
  }

  const [total, items] = await Promise.all([
    prisma.m_item.count({ where }),
    prisma.m_item.findMany({
      where,
      include: { stocks: true },
      orderBy: [{ [parsed.order]: parsed.direction }, { id: "asc" }],
      ...(parsed.all
        ? {}
        : { skip: (parsed.page - 1) * parsed.limit, take: parsed.limit }),
    }),
  ]);

  const data = items.map((item) => {
    const warehouse = item.stocks
      .filter((stock) => stock.location === "WAREHOUSE")
      .reduce((sum, stock) => sum + stock.qty, 0);
    const shelf = item.stocks
      .filter((stock) => stock.location === "SHELF")
      .reduce((sum, stock) => sum + stock.qty, 0);

    return {
      item_id: item.id,
      barcode: item.barcode,
      nama_barang: item.nama_barang,
      base_unit: item.base_unit,
      min_stock: item.min_stock,
      max_stock: item.max_stock,
      warehouse,
      shelf,
      total: warehouse + shelf,
      below_min: warehouse + shelf <= item.min_stock,
    };
  });

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

export async function getStockDetailService(itemId) {
  const item = await prisma.m_item.findUnique({
    where: { id: itemId },
    include: {
      category: true,
      stocks: { orderBy: [{ expired_date: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!item) fail(404, "Barang tidak ditemukan");

  const locations = ["WAREHOUSE", "SHELF"].map((location) => ({
    location,
    total: item.stocks
      .filter((stock) => stock.location === location)
      .reduce((sum, stock) => sum + stock.qty, 0),
    lots: item.stocks.filter((stock) => stock.location === location),
  }));

  return { item, locations };
}

export async function listStockCardsService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["tanggal", "createdAt"],
  });
  const { from, to } = parseDateRange(query);

  const where = {};
  if (query.item_id) where.item_id = query.item_id;
  if (query.location) where.location = query.location;
  if (query.jenis_mutasi) where.jenis_mutasi = query.jenis_mutasi;
  if (from || to) {
    where.tanggal = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  if (parsed.search) where.no_dokumen = { contains: parsed.search, mode: "insensitive" };

  const [total, data] = await Promise.all([
    prisma.t_stock_card.count({ where }),
    prisma.t_stock_card.findMany({
      where,
      include: { item: { select: ITEM_SELECT } },
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

export async function createMutationService(body, userId) {
  const value = validate(mutationSchema, body);
  if (value.from_location === value.to_location) {
    fail(400, "Lokasi asal dan tujuan harus berbeda");
  }

  return securityTransaction(async (tx) => {
    const noMutasi = await nextDocumentNumber(tx, {
      model: "t_stock_mutation",
      field: "no_mutasi",
      prefix: "MUT",
    });

    const header = await tx.t_stock_mutation.create({
      data: {
        no_mutasi: noMutasi,
        from_location: value.from_location,
        to_location: value.to_location,
        keterangan: value.catatan,
        user_id: userId,
        details: {
          create: value.items.map((item) => ({
            item_id: item.item_id,
            qty: item.qty,
          })),
        },
      },
    });

    for (const item of value.items) {
      await assertItemExists(tx, item.item_id);
      await moveStockLots(tx, {
        itemId: item.item_id,
        fromLocation: value.from_location,
        toLocation: value.to_location,
        qty: item.qty,
        referenceNo: noMutasi,
        userId,
        note: value.catatan,
      });
    }

    return tx.t_stock_mutation.findUnique({
      where: { id: header.id },
      include: { details: true },
    });
  });
}

export async function listMutationsService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["createdAt", "tgl_mutasi"],
  });

  const where = {};
  if (parsed.search) where.no_mutasi = { contains: parsed.search, mode: "insensitive" };
  if (query.status) where.status = query.status;

  const [total, data] = await Promise.all([
    prisma.t_stock_mutation.count({ where }),
    prisma.t_stock_mutation.findMany({
      where,
      include: { details: true },
      orderBy: [{ createdAt: parsed.direction }],
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

export async function getMutationService(id) {
  const data = await prisma.t_stock_mutation.findUnique({
    where: { id },
    include: { details: true },
  });
  if (!data) fail(404, "Mutasi tidak ditemukan");
  return data;
}

export async function createAdjustmentService(body, userId) {
  const value = validate(adjustmentSchema, body);

  return securityTransaction(async (tx) => {
    const noAdjustment = await nextDocumentNumber(tx, {
      model: "t_stock_adjustment",
      field: "no_adjustment",
      prefix: "ADJ",
    });

    const header = await tx.t_stock_adjustment.create({
      data: {
        no_adjustment: noAdjustment,
        location: value.location,
        reason_code: value.reason_code,
        catatan: value.catatan,
        user_id: userId,
        details: {
          create: value.items.map((item) => ({
            item_id: item.item_id,
            qty: item.qty,
          })),
        },
      },
    });

    for (const item of value.items) {
      await assertItemExists(tx, item.item_id);
      await removeStockFEFO(tx, {
        itemId: item.item_id,
        location: value.location,
        qty: item.qty,
        mutationType: "OUT_DAMAGED",
        referenceNo: noAdjustment,
        userId,
        note: `${value.reason_code}${value.catatan ? ` - ${value.catatan}` : ""}`,
      });
    }

    return tx.t_stock_adjustment.findUnique({
      where: { id: header.id },
      include: { details: true },
    });
  });
}

export async function listAdjustmentsService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["tgl_adjustment", "createdAt"],
  });

  const where = {};
  if (query.location) where.location = query.location;
  if (query.reason_code) where.reason_code = query.reason_code;
  if (parsed.search) {
    where.no_adjustment = { contains: parsed.search, mode: "insensitive" };
  }

  const [total, data] = await Promise.all([
    prisma.t_stock_adjustment.count({ where }),
    prisma.t_stock_adjustment.findMany({
      where,
      include: { details: true },
      orderBy: [{ createdAt: parsed.direction }],
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

export async function getAdjustmentService(id) {
  const data = await prisma.t_stock_adjustment.findUnique({
    where: { id },
    include: { details: true },
  });
  if (!data) fail(404, "Penyesuaian stok tidak ditemukan");
  return data;
}

async function buildOpnameLines(tx, location, items) {
  const lines = [];
  for (const item of items) {
    await assertItemExists(tx, item.item_id);
    const qtySystem = await sumStock(tx, item.item_id, location);
    lines.push({
      item_id: item.item_id,
      location,
      qty_system: qtySystem,
      qty_fisik: item.qty_fisik,
      selisih: item.qty_fisik - qtySystem,
      batch_number: item.batch_number || null,
      expired_date: item.expired_date || null,
      reason_code: item.reason_code || null,
      keterangan: item.keterangan || null,
    });
  }
  return lines;
}

export async function createOpnameService(body, userId) {
  const value = validate(opnameSchema, body);

  return securityTransaction(async (tx) => {
    const noOpname = await nextDocumentNumber(tx, {
      model: "t_stock_opname",
      field: "no_opname",
      prefix: "OPN",
    });
    const lines = await buildOpnameLines(tx, value.location, value.items);

    return tx.t_stock_opname.create({
      data: {
        no_opname: noOpname,
        status: "DRAFT",
        catatan: value.catatan,
        user_id: userId,
        details: { create: lines },
      },
      include: { details: true },
    });
  });
}

export async function updateOpnameService(id, body) {
  const value = validate(opnameSchema, body);

  return securityTransaction(async (tx) => {
    const existing = await tx.t_stock_opname.findUnique({ where: { id } });
    if (!existing) fail(404, "Stock opname tidak ditemukan");
    if (existing.status !== "DRAFT") {
      fail(409, "Hanya opname berstatus DRAFT yang dapat diubah");
    }

    const lines = await buildOpnameLines(tx, value.location, value.items);

    return tx.t_stock_opname.update({
      where: { id },
      data: {
        catatan: value.catatan,
        details: { deleteMany: {}, create: lines },
      },
      include: { details: true },
    });
  });
}

export async function submitOpnameService(id) {
  return securityTransaction(async (tx) => {
    const existing = await tx.t_stock_opname.findUnique({ where: { id } });
    if (!existing) fail(404, "Stock opname tidak ditemukan");
    if (existing.status !== "DRAFT") {
      fail(409, "Hanya opname DRAFT yang dapat diajukan");
    }
    return tx.t_stock_opname.update({
      where: { id },
      data: { status: "IN_APPROVAL" },
      include: { details: true },
    });
  });
}

export async function approveOpnameService(id, userId) {
  return securityTransaction(async (tx) => {
    const opname = await tx.t_stock_opname.findUnique({
      where: { id },
      include: { details: true },
    });
    if (!opname) fail(404, "Stock opname tidak ditemukan");
    if (opname.status !== "IN_APPROVAL") {
      fail(409, "Hanya opname berstatus IN_APPROVAL yang dapat disetujui");
    }

    for (const line of opname.details) {
      if (line.selisih > 0) {
        await addStock(tx, {
          itemId: line.item_id,
          location: line.location,
          qty: line.selisih,
          batchNumber: line.batch_number,
          expiredDate: line.expired_date,
        });
        await writeCard(tx, {
          itemId: line.item_id,
          location: line.location,
          mutationType: "ADJUST_OPNAME",
          qtyIn: line.selisih,
          referenceNo: opname.no_opname,
          userId,
          note: line.keterangan || "Koreksi stock opname",
        });
      } else if (line.selisih < 0) {
        await removeStockFEFO(tx, {
          itemId: line.item_id,
          location: line.location,
          qty: Math.abs(line.selisih),
          mutationType: "ADJUST_OPNAME",
          referenceNo: opname.no_opname,
          userId,
          note: line.keterangan || "Koreksi stock opname",
        });
      }
    }

    return tx.t_stock_opname.update({
      where: { id },
      data: {
        status: "APPROVED",
        approved_by: userId,
        approved_at: new Date(),
      },
      include: { details: true },
    });
  });
}

export async function rejectOpnameService(id, body, userId) {
  const value = validate(opnameRejectSchema, body);

  return securityTransaction(async (tx) => {
    const opname = await tx.t_stock_opname.findUnique({ where: { id } });
    if (!opname) fail(404, "Stock opname tidak ditemukan");
    if (opname.status !== "IN_APPROVAL") {
      fail(409, "Hanya opname berstatus IN_APPROVAL yang dapat ditolak");
    }
    return tx.t_stock_opname.update({
      where: { id },
      data: {
        status: "REJECT",
        approved_by: userId,
        approved_at: new Date(),
        catatan: value.catatan,
      },
      include: { details: true },
    });
  });
}

export async function listOpnamesService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["tgl_opname", "createdAt"],
  });

  const where = {};
  if (query.status) where.status = query.status;
  if (query.location) where.location = query.location;
  if (parsed.search) {
    where.no_opname = { contains: parsed.search, mode: "insensitive" };
  }

  const [total, data] = await Promise.all([
    prisma.t_stock_opname.count({ where }),
    prisma.t_stock_opname.findMany({
      where,
      include: { details: true },
      orderBy: [{ createdAt: parsed.direction }],
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

async function enrichItems(rows, key = "item_id") {
  const ids = [...new Set(rows.map((row) => row[key]).filter(Boolean))];
  if (!ids.length) return rows;
  const items = await prisma.m_item.findMany({
    where: { id: { in: ids } },
    select: ITEM_SELECT,
  });
  const map = new Map(items.map((item) => [item.id, item]));
  return rows.map((row) => ({ ...row, item: map.get(row[key]) || null }));
}

export async function getOpnameService(id) {
  const data = await prisma.t_stock_opname.findUnique({
    where: { id },
    include: { details: true },
  });
  if (!data) fail(404, "Stock opname tidak ditemukan");
  return { ...data, details: await enrichItems(data.details) };
}

export async function listMinStockAlertsService(query = {}) {
  const items = await prisma.m_item.findMany({
    where: { is_active: true },
    include: { stocks: true, category: true },
  });

  const data = items
    .map((item) => {
      const total = item.stocks.reduce((sum, stock) => sum + stock.qty, 0);
      return {
        item_id: item.id,
        barcode: item.barcode,
        nama_barang: item.nama_barang,
        kategori: item.category?.name || null,
        base_unit: item.base_unit,
        total_stock: total,
        min_stock: item.min_stock,
        max_stock: item.max_stock,
        suggested_qty:
          item.max_stock > 0
            ? Math.max(item.max_stock - total, 0)
            : Math.max(item.min_stock * 2 - total, 0),
      };
    })
    .filter((item) => item.total_stock <= item.min_stock)
    .sort((a, b) => a.total_stock - b.total_stock);

  return { data, total: data.length };
}

export async function listExpiredAlertsService(query = {}) {
  const days = Math.max(Number(query.days || 60), 0);
  const limitDate = new Date();
  limitDate.setDate(limitDate.getDate() + days);

  const data = await prisma.t_stock.findMany({
    where: {
      qty: { gt: 0 },
      expired_date: { not: null, lte: limitDate },
    },
    include: { item: { select: ITEM_SELECT } },
    orderBy: { expired_date: "asc" },
  });

  const now = new Date();
  return {
    data: data.map((row) => ({
      ...row,
      days_left: Math.ceil((row.expired_date - now) / (24 * 60 * 60 * 1000)),
    })),
    total: data.length,
  };
}
