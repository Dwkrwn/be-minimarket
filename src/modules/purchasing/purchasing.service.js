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
import { createCrudService } from "../../core/crud.js";
import {
  ITEM_SELECT,
  assertItemExists,
  addStock,
  removeStockFEFO,
  writeCard,
} from "../inventory/stock.helper.js";
import {
  supplierSchema,
  supplierPriceSchema,
  purchaseOrderSchema,
  goodsReceiptSchema,
  purchaseReturnSchema,
  purchaseInvoiceSchema,
  invoiceStatusSchema,
} from "./purchasing.validation.js";

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const toNumber = (value) => (value == null ? 0 : Number(value));

const supplierInclude = {
  _count: { select: { purchase_orders: true, prices: true } },
};

const poInclude = {
  supplier: true,
  details: { include: { item: { select: ITEM_SELECT } } },
  receipts: { include: { details: true } },
  returns: { include: { details: true } },
  invoice: true,
};

const grInclude = {
  po: { include: { supplier: true } },
  details: { include: { item: { select: ITEM_SELECT } } },
};

const returnInclude = {
  po: { include: { supplier: true } },
  details: true,
};

const invoiceInclude = {
  po: {
    include: {
      supplier: true,
      details: { include: { item: { select: ITEM_SELECT } } },
      receipts: { include: { details: true } },
      returns: { include: { details: true } },
    },
  },
};

export const supplierService = createCrudService({
  model: prisma.m_supplier,
  label: "Supplier",
  searchFields: ["kode_supplier", "nama_supplier", "kontak_sales", "no_telp"],
  filterFields: ["is_active", "kode_supplier"],
  allowedOrder: [
    "nama_supplier",
    "kode_supplier",
    "createdAt",
    "updatedAt",
    "is_active",
  ],
  include: supplierInclude,
  schema: supplierSchema,
});

export const supplierPriceService = createCrudService({
  model: prisma.m_supplier_price,
  label: "Harga supplier",
  filterFields: ["supplier_id", "item_id", "is_active"],
  allowedOrder: ["harga_beli", "createdAt", "updatedAt"],
  include: {
    supplier: { select: { id: true, kode_supplier: true, nama_supplier: true } },
  },
  schema: supplierPriceSchema,
});

export async function getSupplierPricesService(supplierId) {
  const supplier = await prisma.m_supplier.findUnique({
    where: { id: supplierId },
  });
  if (!supplier) fail(404, "Supplier tidak ditemukan");

  const prices = await prisma.m_supplier_price.findMany({
    where: { supplier_id: supplierId },
    orderBy: { createdAt: "desc" },
  });

  return { supplier, prices: await enrichItems(prices) };
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

/* ==========================================================================
 * PURCHASE ORDER
 * ========================================================================== */

function buildOrderDetails(items) {
  return items.map((item) => {
    const price = toNumber(item.harga_satuan);
    return {
      item_id: item.item_id,
      qty: item.qty,
      harga_satuan: price,
      subtotal: round2(item.qty * price),
    };
  });
}

async function getOrderOrFail(tx, id) {
  const po = await tx.t_purchase_order.findUnique({
    where: { id },
    include: poInclude,
  });
  if (!po) fail(404, "Purchase order tidak ditemukan");
  return po;
}

export async function listPurchaseOrdersService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["tgl_po", "no_po", "createdAt", "updatedAt", "status"],
  });
  const { from, to } = parseDateRange(query);

  const where = {};
  if (query.status) where.status = query.status;
  if (query.supplier_id) where.supplier_id = query.supplier_id;
  if (from || to) {
    where.tgl_po = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  if (parsed.search) {
    where.OR = [
      { no_po: { contains: parsed.search, mode: "insensitive" } },
      { supplier: { nama_supplier: { contains: parsed.search, mode: "insensitive" } } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.t_purchase_order.count({ where }),
    prisma.t_purchase_order.findMany({
      where,
      include: {
        supplier: true,
        details: { include: { item: { select: ITEM_SELECT } } },
      },
      orderBy: [{ [parsed.order]: parsed.direction }, { id: "asc" }],
      ...(parsed.all
        ? {}
        : { skip: (parsed.page - 1) * parsed.limit, take: parsed.limit }),
    }),
  ]);

  const data = rows.map((po) => ({
    ...po,
    total: round2(
      po.details.reduce((sum, line) => sum + toNumber(line.subtotal), 0),
    ),
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

export async function getPurchaseOrderService(id) {
  const po = await prisma.t_purchase_order.findUnique({
    where: { id },
    include: poInclude,
  });
  if (!po) fail(404, "Purchase order tidak ditemukan");

  const receivedByItem = aggregateReceived(po.receipts);
  const returnedByItem = aggregateReturned(po.returns);

  return {
    ...po,
    total: round2(
      po.details.reduce((sum, line) => sum + toNumber(line.subtotal), 0),
    ),
    details: po.details.map((line) => ({
      ...line,
      qty_diterima: receivedByItem.get(line.item_id) || 0,
      qty_retur: returnedByItem.get(line.item_id) || 0,
      qty_sisa: Math.max(
        line.qty - (receivedByItem.get(line.item_id) || 0),
        0,
      ),
    })),
  };
}

function aggregateReceived(receipts = []) {
  const map = new Map();
  for (const receipt of receipts) {
    for (const line of receipt.details || []) {
      map.set(line.item_id, (map.get(line.item_id) || 0) + line.qty_diterima);
    }
  }
  return map;
}

function aggregateReturned(returns = []) {
  const map = new Map();
  for (const retur of returns) {
    if (retur.status !== "COMPLETED") continue;
    for (const line of retur.details || []) {
      map.set(line.item_id, (map.get(line.item_id) || 0) + line.qty);
    }
  }
  return map;
}

export async function createPurchaseOrderService(body, userId) {
  const value = validate(purchaseOrderSchema, body);

  return securityTransaction(async (tx) => {
    const supplier = await tx.m_supplier.findUnique({
      where: { id: value.supplier_id },
    });
    if (!supplier) fail(404, "Supplier tidak ditemukan");
    if (!supplier.is_active) fail(409, "Supplier tidak aktif");

    for (const item of value.items) await assertItemExists(tx, item.item_id);

    const noPo = await nextDocumentNumber(tx, {
      model: "t_purchase_order",
      field: "no_po",
      prefix: "PO",
    });

    return tx.t_purchase_order.create({
      data: {
        no_po: noPo,
        supplier_id: value.supplier_id,
        status: "DRAFT",
        tgl_dikirim: value.tgl_dikirim || null,
        catatan: value.catatan,
        user_id: userId,
        details: { create: buildOrderDetails(value.items) },
      },
      include: poInclude,
    });
  });
}

export async function updatePurchaseOrderService(id, body) {
  const value = validate(purchaseOrderSchema, body);

  return securityTransaction(async (tx) => {
    const existing = await tx.t_purchase_order.findUnique({ where: { id } });
    if (!existing) fail(404, "Purchase order tidak ditemukan");
    if (existing.status !== "DRAFT") {
      fail(409, "Hanya PO berstatus DRAFT yang dapat diubah");
    }

    const supplier = await tx.m_supplier.findUnique({
      where: { id: value.supplier_id },
    });
    if (!supplier?.is_active) fail(409, "Supplier tidak ditemukan atau tidak aktif");

    for (const item of value.items) await assertItemExists(tx, item.item_id);

    return tx.t_purchase_order.update({
      where: { id },
      data: {
        supplier_id: value.supplier_id,
        tgl_dikirim: value.tgl_dikirim || null,
        catatan: value.catatan,
        details: { deleteMany: {}, create: buildOrderDetails(value.items) },
      },
      include: poInclude,
    });
  });
}

export async function setPurchaseOrderStatusService(id, status) {
  const allowed = ["ORDERED", "CANCELLED"];
  if (!allowed.includes(status)) {
    fail(400, "Status PO tidak valid");
  }

  return securityTransaction(async (tx) => {
    const po = await tx.t_purchase_order.findUnique({
      where: { id },
      include: { receipts: true },
    });
    if (!po) fail(404, "Purchase order tidak ditemukan");

    if (status === "ORDERED") {
      if (po.status !== "DRAFT") {
        fail(409, "Hanya PO DRAFT yang dapat dipesan");
      }
    }

    if (status === "CANCELLED") {
      if (po.status === "COMPLETED") {
        fail(409, "PO selesai tidak dapat dibatalkan");
      }
      if (po.receipts.length) {
        fail(409, "PO yang sudah memiliki penerimaan tidak dapat dibatalkan");
      }
    }

    return tx.t_purchase_order.update({
      where: { id },
      data: { status },
      include: poInclude,
    });
  });
}

/* ==========================================================================
 * GOODS RECEIPT (penerimaan barang)
 * ========================================================================== */

export async function listGoodsReceiptsService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["tgl_gr", "no_gr", "createdAt"],
  });
  const { from, to } = parseDateRange(query);

  const where = {};
  if (query.po_id) where.po_id = query.po_id;
  if (query.status) where.status = query.status;
  if (from || to) {
    where.tgl_gr = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  if (parsed.search) {
    where.OR = [{ no_gr: { contains: parsed.search, mode: "insensitive" } }];
  }

  const [total, data] = await Promise.all([
    prisma.t_goods_receipt.count({ where }),
    prisma.t_goods_receipt.findMany({
      where,
      include: grInclude,
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

export async function getGoodsReceiptService(id) {
  const data = await prisma.t_goods_receipt.findUnique({
    where: { id },
    include: grInclude,
  });
  if (!data) fail(404, "Penerimaan barang tidak ditemukan");
  return data;
}

export async function createGoodsReceiptService(body, userId) {
  const value = validate(goodsReceiptSchema, body);
  if (!value.items.some((line) => line.qty_diterima > 0)) {
    fail(400, "Minimal satu barang harus diterima");
  }

  return securityTransaction(async (tx) => {
    const po = await tx.t_purchase_order.findUnique({
      where: { id: value.po_id },
      include: {
        supplier: true,
        details: true,
        receipts: { include: { details: true } },
      },
    });
    if (!po) fail(404, "Purchase order tidak ditemukan");
    if (!["ORDERED", "PARTIAL"].includes(po.status)) {
      fail(409, "PO harus berstatus ORDERED atau PARTIAL untuk menerima barang");
    }

    const receivedByItem = aggregateReceived(po.receipts);
    const poByItem = new Map(po.details.map((line) => [line.item_id, line]));

    for (const line of value.items) {
      const poLine = poByItem.get(line.item_id);
      if (!poLine) {
        fail(400, "Terdapat barang yang tidak ada pada PO");
      }
      const already = receivedByItem.get(line.item_id) || 0;
      if (already + line.qty_diterima > poLine.qty) {
        fail(
          409,
          `Qty diterima melebihi qty PO untuk barang ${line.item_id} (PO ${poLine.qty}, sudah diterima ${already})`,
        );
      }
    }

    const noGr = await nextDocumentNumber(tx, {
      model: "t_goods_receipt",
      field: "no_gr",
      prefix: "GR",
    });

    const receipt = await tx.t_goods_receipt.create({
      data: {
        no_gr: noGr,
        po_id: po.id,
        status: "COMPLETED",
        catatan: value.catatan,
        user_id: userId,
        details: {
          create: value.items.map((line) => ({
            item_id: line.item_id,
            qty_diterima: line.qty_diterima,
            qty_ditolak: line.qty_ditolak,
            batch_number: line.batch_number || null,
            expired_date: line.expired_date || null,
            harga_satuan: line.harga_satuan,
          })),
        },
      },
    });

    for (const line of value.items) {
      if (line.qty_diterima <= 0) continue;
      await addStock(tx, {
        itemId: line.item_id,
        location: "WAREHOUSE",
        qty: line.qty_diterima,
        batchNumber: line.batch_number || null,
        expiredDate: line.expired_date || null,
      });
      await writeCard(tx, {
        itemId: line.item_id,
        location: "WAREHOUSE",
        mutationType: "IN_PURCHASE",
        qtyIn: line.qty_diterima,
        referenceNo: noGr,
        userId,
        note: `Penerimaan PO ${po.no_po}`,
      });
    }

    const totalReceived = new Map(receivedByItem);
    for (const line of value.items) {
      totalReceived.set(
        line.item_id,
        (totalReceived.get(line.item_id) || 0) + line.qty_diterima,
      );
    }
    const complete = po.details.every(
      (line) => (totalReceived.get(line.item_id) || 0) >= line.qty,
    );

    await tx.t_purchase_order.update({
      where: { id: po.id },
      data: { status: complete ? "COMPLETED" : "PARTIAL" },
    });

    return tx.t_goods_receipt.findUnique({
      where: { id: receipt.id },
      include: grInclude,
    });
  });
}

/* ==========================================================================
 * PURCHASE RETURN (retur pembelian)
 * ========================================================================== */

export async function listPurchaseReturnsService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["tgl_retur", "no_retur", "createdAt"],
  });
  const { from, to } = parseDateRange(query);

  const where = {};
  if (query.po_id) where.po_id = query.po_id;
  if (query.status) where.status = query.status;
  if (query.reason_code) where.reason_code = query.reason_code;
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
    prisma.t_purchase_return.count({ where }),
    prisma.t_purchase_return.findMany({
      where,
      include: returnInclude,
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
        details: await enrichItems(retur.details),
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

export async function getPurchaseReturnService(id) {
  const data = await prisma.t_purchase_return.findUnique({
    where: { id },
    include: returnInclude,
  });
  if (!data) fail(404, "Retur pembelian tidak ditemukan");
  return { ...data, details: await enrichItems(data.details) };
}

export async function createPurchaseReturnService(body, userId) {
  const value = validate(purchaseReturnSchema, body);

  return securityTransaction(async (tx) => {
    const po = await tx.t_purchase_order.findUnique({
      where: { id: value.po_id },
      include: {
        details: true,
        receipts: { include: { details: true } },
        returns: { include: { details: true } },
      },
    });
    if (!po) fail(404, "Purchase order tidak ditemukan");
    if (po.status === "CANCELLED") fail(409, "PO dibatalkan tidak dapat diretur");

    const received = aggregateReceived(po.receipts);
    const returned = aggregateReturned(po.returns);
    const poByItem = new Map(po.details.map((line) => [line.item_id, line]));

    for (const line of value.items) {
      if (!poByItem.has(line.item_id)) {
        fail(400, "Terdapat barang yang tidak ada pada PO");
      }
      const available =
        (received.get(line.item_id) || 0) - (returned.get(line.item_id) || 0);
      if (line.qty > available) {
        fail(
          409,
          `Qty retur melebihi qty yang pernah diterima untuk barang ${line.item_id} (tersedia ${available})`,
        );
      }
    }

    const noRetur = await nextDocumentNumber(tx, {
      model: "t_purchase_return",
      field: "no_retur",
      prefix: "RTP",
    });

    return tx.t_purchase_return.create({
      data: {
        no_retur: noRetur,
        po_id: po.id,
        reason_code: value.reason_code,
        status: "DRAFT",
        catatan: value.catatan,
        user_id: userId,
        details: { create: value.items },
      },
      include: returnInclude,
    });
  });
}

export async function completePurchaseReturnService(id, userId) {
  return securityTransaction(async (tx) => {
    const retur = await tx.t_purchase_return.findUnique({
      where: { id },
      include: { po: true, details: true },
    });
    if (!retur) fail(404, "Retur pembelian tidak ditemukan");
    if (retur.status !== "DRAFT") {
      fail(409, "Hanya retur DRAFT yang dapat diproses");
    }

    for (const line of retur.details) {
      await removeStockFEFO(tx, {
        itemId: line.item_id,
        location: "WAREHOUSE",
        qty: line.qty,
        mutationType: "OUT_RETURN",
        referenceNo: retur.no_retur,
        userId,
        note: `Retur pembelian ${retur.reason_code}`,
      });
    }

    return tx.t_purchase_return.update({
      where: { id },
      data: { status: "COMPLETED" },
      include: returnInclude,
    });
  });
}

export async function cancelPurchaseReturnService(id) {
  return securityTransaction(async (tx) => {
    const retur = await tx.t_purchase_return.findUnique({ where: { id } });
    if (!retur) fail(404, "Retur pembelian tidak ditemukan");
    if (retur.status !== "DRAFT") {
      fail(409, "Hanya retur DRAFT yang dapat dibatalkan");
    }
    return tx.t_purchase_return.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: returnInclude,
    });
  });
}

/* ==========================================================================
 * PURCHASE INVOICE + 3-WAY MATCHING + AP SCHEDULE
 * ========================================================================== */

function threeWayMatching(po, totalTagihan) {
  const receivedByItem = aggregateReceived(po.receipts);
  const lines = po.details.map((line) => {
    const qtyReceived = receivedByItem.get(line.item_id) || 0;
    return {
      item_id: line.item_id,
      qty_po: line.qty,
      qty_diterima: qtyReceived,
      harga_po: toNumber(line.harga_satuan),
      nilai_diterima: round2(qtyReceived * toNumber(line.harga_satuan)),
    };
  });

  const nilaiPenerimaan = round2(
    lines.reduce((sum, line) => sum + line.nilai_diterima, 0),
  );
  const selisih = round2(toNumber(totalTagihan) - nilaiPenerimaan);

  return {
    cocok: Math.abs(selisih) <= 0.01,
    nilai_penerimaan: nilaiPenerimaan,
    total_tagihan: round2(totalTagihan),
    selisih,
    lines,
  };
}

export async function listPurchaseInvoicesService(query = {}) {
  const parsed = parseListQuery(query, {
    allowedOrder: ["tgl_invoice", "tgl_jatuh_tempo", "createdAt", "status"],
  });
  const { from, to } = parseDateRange(query);

  const where = {};
  if (query.status) where.status = query.status;
  if (query.po_id) where.po_id = query.po_id;
  if (from || to) {
    where.tgl_invoice = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  if (parsed.search) {
    where.OR = [
      { no_invoice: { contains: parsed.search, mode: "insensitive" } },
      { po: { no_po: { contains: parsed.search, mode: "insensitive" } } },
    ];
  }

  const [total, data] = await Promise.all([
    prisma.t_purchase_invoice.count({ where }),
    prisma.t_purchase_invoice.findMany({
      where,
      include: invoiceInclude,
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

export async function getPurchaseInvoiceService(id) {
  const data = await prisma.t_purchase_invoice.findUnique({
    where: { id },
    include: invoiceInclude,
  });
  if (!data) fail(404, "Invoice pembelian tidak ditemukan");
  return {
    ...data,
    matching: threeWayMatching(data.po, data.total_tagihan),
  };
}

export async function createPurchaseInvoiceService(body, userId) {
  const value = validate(purchaseInvoiceSchema, body);

  return securityTransaction(async (tx) => {
    const po = await tx.t_purchase_order.findUnique({
      where: { id: value.po_id },
      include: {
        supplier: true,
        details: { include: { item: { select: ITEM_SELECT } } },
        receipts: { include: { details: true } },
        invoice: true,
      },
    });
    if (!po) fail(404, "Purchase order tidak ditemukan");
    if (po.invoice) fail(409, "PO ini sudah memiliki invoice");
    if (!po.receipts.length) {
      fail(409, "Invoice hanya dapat dibuat setelah ada penerimaan barang");
    }

    const matching = threeWayMatching(po, value.total_tagihan);
    if (!matching.cocok && !value.force) {
      fail(
        409,
        `3-way matching gagal: total tagihan ${matching.total_tagihan} berbeda dengan nilai penerimaan ${matching.nilai_penerimaan} (selisih ${matching.selisih}). Gunakan force=true bila selisih disetujui.`,
      );
    }

    const tglInvoice = value.tgl_invoice ? new Date(value.tgl_invoice) : new Date();
    const jatuhTempo = value.tgl_jatuh_tempo
      ? new Date(value.tgl_jatuh_tempo)
      : new Date(
          tglInvoice.getTime() +
            (po.supplier.term_of_payment || 0) * 24 * 60 * 60 * 1000,
        );

    if (jatuhTempo < tglInvoice) {
      fail(400, "Tanggal jatuh tempo tidak boleh sebelum tanggal invoice");
    }

    const invoice = await tx.t_purchase_invoice.create({
      data: {
        no_invoice: value.no_invoice,
        po_id: po.id,
        tgl_invoice: tglInvoice,
        tgl_jatuh_tempo: jatuhTempo,
        total_tagihan: value.total_tagihan,
        status: "UNPAID",
        user_id: userId,
        catatan: value.catatan,
      },
      include: invoiceInclude,
    });

    return { ...invoice, matching };
  });
}

export async function updatePurchaseInvoiceStatusService(id, body) {
  const value = validate(invoiceStatusSchema, body);

  return securityTransaction(async (tx) => {
    const invoice = await tx.t_purchase_invoice.findUnique({ where: { id } });
    if (!invoice) fail(404, "Invoice pembelian tidak ditemukan");

    return tx.t_purchase_invoice.update({
      where: { id },
      data: { status: value.status },
      include: invoiceInclude,
    });
  });
}

/**
 * Daftar hutang (AP schedule) dengan aging bucket.
 */
export async function listPayablesService(query = {}) {
  const where = {};
  if (query.status) where.status = query.status;
  else where.status = { in: ["UNPAID", "PARTIAL"] };

  if (query.supplier_id) {
    where.po = { supplier_id: query.supplier_id };
  }

  const invoices = await prisma.t_purchase_invoice.findMany({
    where,
    include: invoiceInclude,
    orderBy: { tgl_jatuh_tempo: "asc" },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const data = invoices.map((invoice) => {
    const due = new Date(invoice.tgl_jatuh_tempo);
    due.setHours(0, 0, 0, 0);
    const days = Math.round((due - today) / (24 * 60 * 60 * 1000));

    let bucket = "CURRENT";
    if (days < 0) bucket = "OVERDUE";
    else if (days <= 7) bucket = "DUE_7";
    else if (days <= 30) bucket = "DUE_30";
    else bucket = "DUE_30_PLUS";

    return {
      ...invoice,
      days_to_due: days,
      overdue: days < 0,
      bucket,
    };
  });

  const summary = {
    total_tagihan: round2(
      data.reduce((sum, row) => sum + toNumber(row.total_tagihan), 0),
    ),
    overdue: round2(
      data
        .filter((row) => row.bucket === "OVERDUE")
        .reduce((sum, row) => sum + toNumber(row.total_tagihan), 0),
    ),
    due_7: round2(
      data
        .filter((row) => row.bucket === "DUE_7")
        .reduce((sum, row) => sum + toNumber(row.total_tagihan), 0),
    ),
    due_30: round2(
      data
        .filter((row) => row.bucket === "DUE_30")
        .reduce((sum, row) => sum + toNumber(row.total_tagihan), 0),
    ),
    due_30_plus: round2(
      data
        .filter((row) => row.bucket === "DUE_30_PLUS")
        .reduce((sum, row) => sum + toNumber(row.total_tagihan), 0),
    ),
    count: data.length,
  };

  return { data, summary };
}

/* ==========================================================================
 * REKOMENDASI BELANJA (tanpa membuat PO otomatis)
 * ========================================================================== */

export async function listPurchaseRecommendationsService(query = {}) {
  const search = String(query.search || "").trim();
  const supplierId = query.supplier_id || null;

  const items = await prisma.m_item.findMany({
    where: {
      is_active: true,
      ...(search
        ? {
            OR: [
              { barcode: { contains: search, mode: "insensitive" } },
              { nama_barang: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { stocks: true, category: true },
  });

  const belowMin = items
    .map((item) => {
      const total = item.stocks.reduce((sum, stock) => sum + stock.qty, 0);
      return { item, total };
    })
    .filter(({ item, total }) => total <= item.min_stock);

  const itemIds = belowMin.map(({ item }) => item.id);
  const prices = itemIds.length
    ? await prisma.m_supplier_price.findMany({
        where: {
          item_id: { in: itemIds },
          is_active: true,
          ...(supplierId ? { supplier_id: supplierId } : {}),
        },
        include: {
          supplier: {
            select: {
              id: true,
              kode_supplier: true,
              nama_supplier: true,
              term_of_payment: true,
            },
          },
        },
        orderBy: { harga_beli: "asc" },
      })
    : [];

  const cheapestByItem = new Map();
  for (const price of prices) {
    if (!cheapestByItem.has(price.item_id)) {
      cheapestByItem.set(price.item_id, price);
    }
  }

  const data = belowMin.map(({ item, total }) => {
    const suggested =
      item.max_stock > 0
        ? Math.max(item.max_stock - total, 0)
        : Math.max(item.min_stock * 2 - total, 0);
    const price = cheapestByItem.get(item.id) || null;

    return {
      item_id: item.id,
      barcode: item.barcode,
      nama_barang: item.nama_barang,
      kategori: item.category?.name || null,
      base_unit: item.base_unit,
      total_stock: total,
      min_stock: item.min_stock,
      max_stock: item.max_stock,
      suggested_qty: suggested,
      supplier: price?.supplier || null,
      harga_beli: price ? toNumber(price.harga_beli) : null,
      estimasi_biaya: price ? round2(suggested * toNumber(price.harga_beli)) : null,
      catatan: price
        ? "Rekomendasi saja. PO tetap dibuat manual oleh admin."
        : "Belum ada harga supplier untuk barang ini.",
    };
  });

  return {
    data,
    total: data.length,
    estimasi_total: round2(
      data.reduce((sum, row) => sum + (row.estimasi_biaya || 0), 0),
    ),
  };
}
