import test from "node:test";
import assert from "node:assert/strict";
import { executeGoodsReceiptTransaction } from "../../server/modules/purchasing/purchasing.service.js";

const PO_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_A = "22222222-2222-4222-8222-222222222222";
const ITEM_B = "33333333-3333-4333-8333-333333333333";
const ITEM_LUAR = "99999999-9999-4999-8999-999999999999";
const UOM_DUS = "44444444-4444-4444-8444-444444444444";

function buildPo(overrides = {}) {
  return {
    id: PO_ID,
    no_po: "PO-001",
    status: "ORDERED",
    details: [
      { item_id: ITEM_A, qty_order_pcs: 100, harga_satuan: 2500 },
      { item_id: ITEM_B, qty_order_pcs: 50, harga_satuan: 1000 },
    ],
    ...overrides,
  };
}

const MASTER_ITEMS = [
  {
    id: ITEM_A,
    nama_barang: "Beras 1kg",
    category_rack_id: "rack-1",
    uom_id: UOM_DUS,
    uom: { id: UOM_DUS, rasio_konversi: 12 },
  },
  {
    id: ITEM_B,
    nama_barang: "Gula 250g",
    category_rack_id: "rack-2",
    uom_id: null,
    uom: null,
  },
];

const UOMS = [{ id: UOM_DUS, rasio_konversi: 12 }];

function createFakeTx({ po, masterItems = MASTER_ITEMS, uoms = UOMS, priorReceipts = [] }) {
  const state = { gr: null, details: [], stockUpserts: [], stockCards: [], poUpdates: [] };
  let gudangQty = 100;

  const tx = {
    t_purchase_order: {
      findUnique: async () => po,
      update: async ({ where, data }) => {
        state.poUpdates.push({ where, data });
        return { ...po, ...data };
      },
    },
    m_item: {
      findMany: async ({ where }) => masterItems.filter((item) => where.id.in.includes(item.id)),
    },
    m_uom: {
      findMany: async ({ where }) => uoms.filter((uom) => where.id.in.includes(uom.id)),
    },
    t_goods_receipt: {
      findMany: async () => priorReceipts,
      create: async ({ data }) => {
        state.gr = data;
        return { id: "gr-new", ...data };
      },
    },
    t_goods_receipt_d: {
      create: async ({ data }) => {
        state.details.push(data);
        return { id: `grd-${state.details.length}`, ...data };
      },
    },
    t_stock: {
      upsert: async (args) => {
        state.stockUpserts.push(args);
        gudangQty += args.update?.qty?.increment ?? args.create?.qty ?? 0;
        return { qty: gudangQty };
      },
    },
    t_stock_card: {
      create: async ({ data }) => {
        state.stockCards.push(data);
        return data;
      },
    },
  };

  return { state, client: { $transaction: async (fn) => fn(tx) } };
}

test("GR menyimpan detail berharga PO, menambah stok gudang, dan memperbarui status PO", async () => {
  const po = buildPo();
  const { state, client } = createFakeTx({ po });

  const result = await executeGoodsReceiptTransaction(
    {
      po_id: PO_ID,
      no_surat_jalan: "SJ-001",
      items: [
        { item_id: ITEM_A, qty_diterima_beli: 5, qty_ditolak_pcs: 2 },
        { item_id: ITEM_B, qty_bagus_pcs: 50 },
      ],
    },
    "user-1",
    client,
  );

  assert.equal(state.gr.po_id, PO_ID);
  assert.equal(state.gr.status, "RECEIVED");
  assert.equal(state.gr.no_surat_jalan, "SJ-001");
  assert.equal(state.gr.user_id, "user-1");

  assert.equal(state.details.length, 2);
  assert.deepEqual(state.details[0], {
    gr_id: "gr-new",
    item_id: ITEM_A,
    uom_id: UOM_DUS,
    qty_diterima_beli: 5,
    qty_bagus_pcs: 60, // 5 dus x 12
    qty_ditolak_pcs: 2,
    harga_satuan_pcs: 2500, // harga PO, bukan harga modal master
    subtotal: 150000,
  });
  assert.equal(state.details[1].harga_satuan_pcs, 1000);
  assert.equal(state.details[1].qty_bagus_pcs, 50);

  assert.equal(state.stockUpserts.length, 2);
  assert.equal(state.stockUpserts[0].update.qty.increment, 60);
  assert.equal(state.stockUpserts[0].create.location, "GUDANG");
  assert.equal(state.stockUpserts[0].create.category_rack_id, "rack-1");

  assert.equal(state.stockCards.length, 2);
  assert.equal(state.stockCards[0].jenis_mutasi, "GR_MASUK");
  assert.equal(state.stockCards[0].qty_in, 60);
  assert.equal(state.stockCards[0].qty_out, 0);
  assert.equal(state.stockCards[0].saldo_akhir, 160);

  // item-a baru 60/100, sehingga PO belum selesai.
  assert.equal(state.poUpdates.length, 1);
  assert.equal(state.poUpdates[0].data.status, "PARTIAL_RECEIVED");
  assert.equal(result.po_status, "PARTIAL_RECEIVED");
  assert.equal(result.status_label, "🟠 Diterima Sebagian");
});

test("GR menandai PO COMPLETED saat seluruh qty terpenuhi lintas dokumen", async () => {
  const po = buildPo();
  const { state, client } = createFakeTx({
    po,
    priorReceipts: [
      {
        id: "gr-lama",
        details: [
          { item_id: ITEM_A, qty_bagus_pcs: 60 },
          { item_id: ITEM_B, qty_bagus_pcs: 50 },
        ],
      },
    ],
  });

  const result = await executeGoodsReceiptTransaction(
    { po_id: PO_ID, items: [{ item_id: ITEM_A, qty_bagus_pcs: 40 }] },
    null,
    client,
  );

  assert.equal(state.poUpdates[0].data.status, "COMPLETED");
  assert.equal(result.po_status, "COMPLETED");
  assert.equal(result.status_label, "🟢 Selesai");
});

test("GR menolak barang di luar PO sebelum dokumen dibuat (P1 #5)", async () => {
  const po = buildPo();
  const { state, client } = createFakeTx({ po });

  await assert.rejects(
    executeGoodsReceiptTransaction(
      { po_id: PO_ID, items: [{ item_id: ITEM_LUAR, qty_bagus_pcs: 5 }] },
      null,
      client,
    ),
    (error) => error.status === 400 && /tidak terdaftar pada PO/.test(error.message),
  );

  assert.equal(state.gr, null, "dokumen GR tidak boleh dibuat");
  assert.equal(state.stockUpserts.length, 0, "stok tidak boleh berubah");
});

test("GR menolak qty negatif sebelum dokumen dibuat", async () => {
  const po = buildPo();
  const { state, client } = createFakeTx({ po });

  await assert.rejects(
    executeGoodsReceiptTransaction(
      { po_id: PO_ID, items: [{ item_id: ITEM_A, qty_bagus_pcs: -10 }] },
      null,
      client,
    ),
    (error) => error.status === 400 && /bilangan bulat >= 0/.test(error.message),
  );

  assert.equal(state.gr, null);
});

test("GR menolak penerimaan melebihi sisa qty PO", async () => {
  const po = buildPo();
  const { state, client } = createFakeTx({
    po,
    priorReceipts: [{ id: "gr-lama", details: [{ item_id: ITEM_A, qty_bagus_pcs: 90 }] }],
  });

  await assert.rejects(
    executeGoodsReceiptTransaction(
      { po_id: PO_ID, items: [{ item_id: ITEM_A, qty_bagus_pcs: 20 }] },
      null,
      client,
    ),
    (error) => error.status === 400 && /melebihi jumlah PO/.test(error.message),
  );

  assert.equal(state.gr, null);
});

test("GR menolak PO yang sudah COMPLETED / CANCELLED", async () => {
  for (const status of ["COMPLETED", "CANCELLED"]) {
    const { state, client } = createFakeTx({ po: buildPo({ status }) });
    await assert.rejects(
      executeGoodsReceiptTransaction(
        { po_id: PO_ID, items: [{ item_id: ITEM_A, qty_bagus_pcs: 1 }] },
        null,
        client,
      ),
      (error) => error.status === 400 && /tidak dapat menerima barang masuk/.test(error.message),
    );
    assert.equal(state.gr, null);
  }
});

test("GR menolak format id tidak valid sebelum query DB", async () => {
  const { client } = createFakeTx({ po: buildPo() });
  await assert.rejects(
    executeGoodsReceiptTransaction(
      { po_id: "bukan-uuid", items: [{ item_id: ITEM_A, qty_bagus_pcs: 1 }] },
      null,
      client,
    ),
    (error) => error.status === 400,
  );
});
