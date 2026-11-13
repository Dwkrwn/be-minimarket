import test from "node:test";
import assert from "node:assert/strict";
import { createPurchaseInvoice } from "../../server/modules/purchasing/purchasing.service.js";

// PO COMPLETED: 2 baris, 2 Goods Receipt, 2 retur ISSUED.
function buildPo(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    no_po: "PO-001",
    status: "COMPLETED",
    supplier: { id: "sup-1", nama_supplier: "PT Sumber Rejeki", term_of_payment: 30 },
    details: [
      {
        item_id: "item-a",
        qty_order_pcs: 100,
        harga_satuan: 2500,
        item: { nama_barang: "Beras 1kg", barcode: "A001" },
      },
      {
        item_id: "item-b",
        qty_order_pcs: 50,
        harga_satuan: 1000,
        item: { nama_barang: "Gula 250g", barcode: "B001" },
      },
    ],
    goods_receipts: [
      {
        id: "gr-1",
        details: [
          { item_id: "item-a", qty_bagus_pcs: 60, qty_ditolak_pcs: 5 },
          { item_id: "item-b", qty_bagus_pcs: 40, qty_ditolak_pcs: 0 },
        ],
      },
      {
        id: "gr-2",
        details: [
          { item_id: "item-a", qty_bagus_pcs: 40, qty_ditolak_pcs: 0 },
          { item_id: "item-b", qty_bagus_pcs: 10, qty_ditolak_pcs: 0 },
        ],
      },
    ],
    purchase_returns: [
      {
        id: "ret-1",
        status: "ISSUED",
        details: [{ item_id: "item-a", qty_pcs: 10, item: { nama_barang: "Beras 1kg" } }],
      },
      {
        id: "ret-2",
        status: "ISSUED",
        details: [{ item_id: "item-b", qty_pcs: 5, item: { nama_barang: "Gula 250g" } }],
      },
    ],
    ...overrides,
  };
}

// Prisma client palsu: mencatat semua operasi tulis tanpa menyentuh DB.
function createFakeClient({ po, existingInvoice = null, createError = null }) {
  const state = { createdInvoices: [], returnUpdates: [], findUniqueCalls: [] };

  const tx = {
    t_purchase_order: {
      findUnique: async () => po,
    },
    t_purchase_invoice: {
      findUnique: async ({ where }) => {
        state.findUniqueCalls.push(where);
        if (where.po_id !== undefined) return existingInvoice;
        const invoice = state.createdInvoices.find((row) => row.id === where.id);
        if (!invoice) return null;
        return {
          ...invoice,
          returns: po.purchase_returns.filter((retur) => retur.invoice_id === invoice.id),
        };
      },
      create: async ({ data }) => {
        if (createError) throw createError;
        const invoice = { id: "inv-1", ...data };
        state.createdInvoices.push(invoice);
        return invoice;
      },
    },
    t_purchase_return: {
      updateMany: async ({ where, data }) => {
        state.returnUpdates.push({ where, data });
        let count = 0;
        for (const retur of po.purchase_returns) {
          if (where.id.in.includes(retur.id) && retur.status === where.status) {
            Object.assign(retur, data);
            count += 1;
          }
        }
        return { count };
      },
    },
  };

  return { state, client: { $transaction: async (fn) => fn(tx) } };
}

function errorWith(status, message) {
  return Object.assign(new Error(message), { status });
}

test("satu invoice mengagregasi seluruh GR dan seluruh retur PO", async () => {
  const po = buildPo();
  const { state, client } = createFakeClient({ po });

  const invoice = await createPurchaseInvoice(
    { po_id: po.id, no_invoice_supplier: "SUP/2026/001", catatan: "uji" },
    "user-1",
    client,
  );

  assert.equal(state.createdInvoices.length, 1, "hanya satu invoice dibuat");
  assert.equal(invoice.po_id, po.id);
  assert.equal(invoice.gr_id, null, "invoice tidak terikat ke satu GR");
  assert.equal(Number(invoice.gross_amount), 300000);
  assert.equal(Number(invoice.return_deduction), 30000);
  assert.equal(Number(invoice.net_payable), 270000);
  assert.equal(invoice.status, "UNPAID");
  assert.equal(invoice.user_id, "user-1");
  assert.ok(invoice.tgl_jatuh_tempo instanceof Date);

  // TOP 30 hari.
  const days = Math.round(
    (invoice.tgl_jatuh_tempo.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );
  assert.equal(days, 30);

  // Kedua retur ditautkan ke invoice yang sama.
  assert.equal(state.returnUpdates.length, 1);
  assert.deepEqual(state.returnUpdates[0].where.id.in.sort(), ["ret-1", "ret-2"]);
  assert.equal(state.returnUpdates[0].data.invoice_id, "inv-1");
  assert.equal(state.returnUpdates[0].data.status, "MATCHED_INVOICE");
  assert.equal(invoice.returns.length, 2, "respons memuat retur yang baru ditautkan");
});

test("menolak invoice jika PO belum COMPLETED", async () => {
  const po = buildPo({ status: "PARTIAL_RECEIVED" });
  const { state, client } = createFakeClient({ po });

  await assert.rejects(
    createPurchaseInvoice({ po_id: po.id }, "user-1", client),
    (error) => error.status === 400 && /COMPLETED/.test(error.message),
  );
  assert.equal(state.createdInvoices.length, 0);
});

test("menolak invoice kedua untuk PO yang sama", async () => {
  const po = buildPo();
  const { state, client } = createFakeClient({
    po,
    existingInvoice: { id: "inv-lama", no_invoice: "INV-LAMA" },
  });

  await assert.rejects(
    createPurchaseInvoice({ po_id: po.id }, "user-1", client),
    (error) => error.status === 409 && /sudah pernah dibuat/.test(error.message),
  );
  assert.equal(state.createdInvoices.length, 0);
});

test("menolak invoice jika PO belum punya Goods Receipt", async () => {
  const po = buildPo({ goods_receipts: [] });
  const { state, client } = createFakeClient({ po });

  await assert.rejects(
    createPurchaseInvoice({ po_id: po.id }, "user-1", client),
    (error) => error.status === 400 && /Goods Receipt/.test(error.message),
  );
  assert.equal(state.createdInvoices.length, 0);
});

test("menolak GR/retur yang berisi barang di luar PO", async () => {
  const po = buildPo();
  po.goods_receipts[0].details.push({
    item_id: "item-luar",
    qty_bagus_pcs: 1,
    qty_ditolak_pcs: 0,
  });
  const { state, client } = createFakeClient({ po });

  await assert.rejects(
    createPurchaseInvoice({ po_id: po.id }, "user-1", client),
    (error) => error.status === 400 && /tidak terdaftar di PO/.test(error.message),
  );
  assert.equal(state.createdInvoices.length, 0);
});

test("menolak invoice tanpa nilai tagihan bersih", async () => {
  const po = buildPo({ goods_receipts: [] });
  po.goods_receipts = [
    {
      id: "gr-1",
      details: [{ item_id: "item-a", qty_bagus_pcs: 1, qty_ditolak_pcs: 0 }],
    },
  ];
  po.purchase_returns[0].details[0].qty_pcs = 1;
  const { state, client } = createFakeClient({ po });

  await assert.rejects(
    createPurchaseInvoice({ po_id: po.id }, "user-1", client),
    (error) => error.status === 400 && /tagihan bersih/.test(error.message),
  );
  assert.equal(state.createdInvoices.length, 0);
});

test("po_id wajib diisi", async () => {
  const { client } = createFakeClient({ po: buildPo() });
  await assert.rejects(
    createPurchaseInvoice({}, "user-1", client),
    (error) => error.status === 400,
  );
});

test("duplikat po_id dari DB (P2002) diubah menjadi 409 yang ramah", async () => {
  const po = buildPo();
  const { client } = createFakeClient({
    po,
    createError: Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["po_id"] },
    }),
  });

  await assert.rejects(
    createPurchaseInvoice({ po_id: po.id }, "user-1", client),
    (error) => error.status === 409 && /sudah pernah dibuat/.test(error.message),
  );
});

test("duplikat no_invoice dari DB (P2002) diubah menjadi 409 nomor dipakai", async () => {
  const po = buildPo();
  const { client } = createFakeClient({
    po,
    createError: Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["no_invoice"] },
    }),
  });

  await assert.rejects(
    createPurchaseInvoice({ po_id: po.id, no_invoice_supplier: "SUP-1" }, "user-1", client),
    (error) => error.status === 409 && /Nomor invoice/.test(error.message),
  );
});

test("error non-P2002 diteruskan apa adanya", async () => {
  const po = buildPo();
  const { client } = createFakeClient({
    po,
    createError: errorWith(500, "koneksi putus"),
  });

  await assert.rejects(
    createPurchaseInvoice({ po_id: po.id }, "user-1", client),
    (error) => error.status === 500 && error.message === "koneksi putus",
  );
});
