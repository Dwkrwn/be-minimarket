import test from "node:test";
import assert from "node:assert/strict";
import { createPurchaseReturn } from "../../server/modules/purchasing/purchasing.service.js";

const PO_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_A = "22222222-2222-4222-8222-222222222222";
const ITEM_B = "33333333-3333-4333-8333-333333333333";
const SUPPLIER_ID = "44444444-4444-4444-8444-444444444444";
const DAMAGED_ID = "55555555-5555-4555-8555-555555555555";

function buildPo(overrides = {}) {
  return {
    id: PO_ID,
    no_po: "PO-001",
    status: "COMPLETED",
    supplier_id: SUPPLIER_ID,
    supplier: { id: SUPPLIER_ID, nama_supplier: "PT Sumber Rejeki" },
    details: [
      { item_id: ITEM_A, qty_order_pcs: 100, harga_satuan: 2500 },
      { item_id: ITEM_B, qty_order_pcs: 50, harga_satuan: 1000 },
    ],
    goods_receipts: [
      { id: "gr-1", details: [{ item_id: ITEM_A, qty_bagus_pcs: 100 }] },
    ],
    purchase_returns: [
      { id: "ret-lama", status: "ISSUED", details: [{ item_id: ITEM_A, qty_pcs: 10 }] },
    ],
    ...overrides,
  };
}

function createFakeTx({ po = buildPo(), invoice = null, rakQty = 50, damaged = null } = {}) {
  const state = {
    stockUpdates: [],
    damagedCreates: [],
    stockCards: [],
    returns: [],
    damagedUpdates: [],
  };

  const tx = {
    t_purchase_order: { findUnique: async () => po },
    m_item: {
      findUnique: async () => ({
        id: ITEM_A,
        nama_barang: "Beras 1kg",
        harga_modal: 9000, // sengaja beda dari harga PO
        category_rack_id: "rack-1",
      }),
    },
    t_purchase_invoice: { findUnique: async () => invoice },
    t_stock: {
      findUnique: async () => ({ qty: rakQty }),
      update: async ({ where, data }) => {
        state.stockUpdates.push({ where, data });
        return { qty: rakQty - Number(data.qty.decrement || 0) };
      },
    },
    t_stock_damaged: {
      create: async ({ data }) => {
        const record = { id: DAMAGED_ID, ...data };
        state.damagedCreates.push(record);
        return record;
      },
      findUnique: async ({ where }) =>
        damaged ?? state.damagedCreates.find((row) => row.id === where.id) ?? null,
      update: async ({ where, data }) => {
        state.damagedUpdates.push({ where, data });
        return { ...damaged, ...data };
      },
    },
    t_stock_card: {
      create: async ({ data }) => {
        state.stockCards.push(data);
        return data;
      },
    },
    t_purchase_return: {
      findFirst: async () => null,
      create: async ({ data }) => {
        const record = { id: "ret-new", ...data };
        state.returns.push(record);
        return record;
      },
    },
  };

  return { state, client: { $transaction: async (fn) => fn(tx) } };
}

test("retur tanpa damaged_id memotong stok rak, mencatat rusak, dan memakai harga PO", async () => {
  const { state, client } = createFakeTx();

  const result = await createPurchaseReturn(
    { po_id: PO_ID, item_id: ITEM_A, qty_pcs: 10, alasan: "Basi" },
    "user-1",
    client,
  );

  assert.equal(state.stockUpdates.length, 1);
  assert.equal(state.stockUpdates[0].data.qty.decrement, 10);

  assert.equal(state.damagedCreates.length, 1);
  assert.equal(state.damagedCreates[0].qty_pcs, 10);
  assert.equal(state.damagedCreates[0].kategori, "SUPPLIER_RETURN");

  assert.equal(state.stockCards.length, 1);
  assert.equal(state.stockCards[0].jenis_mutasi, "BARANG_RUSAK");
  assert.equal(state.stockCards[0].qty_out, 10);
  assert.equal(state.stockCards[0].saldo_akhir, 40);

  assert.equal(state.returns.length, 1);
  const retur = state.returns[0];
  assert.equal(retur.status, "ISSUED");
  assert.equal(retur.damaged_id, DAMAGED_ID);
  assert.equal(Number(retur.total_potongan), 25000); // 10 x 2.500 harga PO, bukan 9.000
  assert.equal(Number(retur.details.create[0].harga_satuan_pcs), 2500);
  assert.equal(result.id, "ret-new");
});

test("retur ditolak jika melebihi sisa barang diterima (P1 #6)", async () => {
  // Diterima 100, sudah diretur 10 -> sisa 90.
  const { state, client } = createFakeTx();

  await assert.rejects(
    createPurchaseReturn({ po_id: PO_ID, item_id: ITEM_A, qty_pcs: 91 }, null, client),
    (error) => error.status === 400 && /Sisa dapat diretur: 90 Pcs/.test(error.message),
  );

  assert.equal(state.stockUpdates.length, 0, "stok tidak boleh dipotong");
  assert.equal(state.damagedCreates.length, 0);
  assert.equal(state.returns.length, 0);
});

test("retur ditolak jika barang tidak ada di PO", async () => {
  const { state, client } = createFakeTx();
  await assert.rejects(
    createPurchaseReturn({ po_id: PO_ID, item_id: ITEM_B, qty_pcs: 1 }, null, client),
    (error) => error.status === 400 && /Belum ada penerimaan/.test(error.message),
  );
  assert.equal(state.returns.length, 0);
});

test("retur ditolak jika invoice PO sudah terbit", async () => {
  const { state, client } = createFakeTx({ invoice: { no_invoice: "SUP/1" } });
  await assert.rejects(
    createPurchaseReturn({ po_id: PO_ID, item_id: ITEM_A, qty_pcs: 1 }, null, client),
    (error) => error.status === 400 && /sudah terbit/.test(error.message),
  );
  assert.equal(state.stockUpdates.length, 0);
  assert.equal(state.returns.length, 0);
});

test("retur dengan damaged_id tidak memotong stok rak lagi", async () => {
  const damaged = {
    id: DAMAGED_ID,
    item_id: ITEM_A,
    qty_pcs: 10,
    status: "RECORDED",
    no_damaged: "DMG-1",
  };
  const { state, client } = createFakeTx({ damaged });

  const result = await createPurchaseReturn(
    { po_id: PO_ID, item_id: ITEM_A, qty_pcs: 5, damaged_id: DAMAGED_ID },
    null,
    client,
  );

  assert.equal(state.stockUpdates.length, 0);
  assert.equal(state.damagedCreates.length, 0);
  assert.equal(state.returns.length, 1);
  assert.equal(state.returns[0].damaged_id, DAMAGED_ID);
  assert.deepEqual(state.damagedUpdates[0].data, { status: "RETURNED_TO_SUPPLIER" });
  assert.equal(result.id, "ret-new");
});

test("retur ditolak jika stok rak tidak mencukupi", async () => {
  const { state, client } = createFakeTx({ rakQty: 4 });
  await assert.rejects(
    createPurchaseReturn({ po_id: PO_ID, item_id: ITEM_A, qty_pcs: 5 }, null, client),
    (error) => error.status === 400 && /Stok di rak tidak mencukupi/.test(error.message),
  );
  assert.equal(state.damagedCreates.length, 0);
  assert.equal(state.returns.length, 0);
});
