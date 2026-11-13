import test from "node:test";
import assert from "node:assert/strict";
import { executeStockDamagedTransaction } from "../../server/modules/inventory/inventory.service.js";

const PO_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_A = "22222222-2222-4222-8222-222222222222";
const SUPPLIER_ID = "44444444-4444-4444-8444-444444444444";
const DAMAGED_ID = "55555555-5555-4555-8555-555555555555";

function buildPo(overrides = {}) {
  return {
    id: PO_ID,
    no_po: "PO-001",
    status: "COMPLETED",
    supplier_id: SUPPLIER_ID,
    supplier: { id: SUPPLIER_ID, nama_supplier: "PT Sumber Rejeki" },
    details: [{ item_id: ITEM_A, qty_order_pcs: 100, harga_satuan: 2500 }],
    goods_receipts: [{ id: "gr-1", details: [{ item_id: ITEM_A, qty_bagus_pcs: 100 }] }],
    purchase_returns: [],
    ...overrides,
  };
}

function createFakeTx({ po = buildPo(), rakQty = 20 } = {}) {
  const state = { damaged: [], returns: [], stockCards: [] };

  const tx = {
    m_item: {
      findUnique: async () => ({
        id: ITEM_A,
        nama_barang: "Beras 1kg",
        harga_modal: 9000,
        category_rack_id: "rack-1",
        uom: { id: "uom-1", rasio_konversi: 1 },
      }),
    },
    t_stock: {
      findUnique: async () => ({ qty: rakQty }),
      update: async ({ data }) => ({ qty: rakQty - Number(data.qty.decrement || 0) }),
    },
    t_stock_damaged: {
      create: async ({ data }) => {
        const record = { id: DAMAGED_ID, ...data };
        state.damaged.push(record);
        return record;
      },
      findUnique: async () => state.damaged[0] || null,
      update: async () => ({}),
    },
    t_stock_card: {
      create: async ({ data }) => {
        state.stockCards.push(data);
        return data;
      },
    },
    t_purchase_order: { findUnique: async () => po },
    t_purchase_invoice: { findUnique: async () => null },
    t_purchase_return: {
      findFirst: async () => null,
      create: async ({ data }) => {
        const record = { id: "ret-1", ...data };
        state.returns.push(record);
        return record;
      },
    },
  };

  return { state, client: { $transaction: async (fn) => fn(tx) } };
}

test("barang rusak SUPPLIER_RETURN otomatis menerbitkan nota retur berharga PO", async () => {
  const { state, client } = createFakeTx();

  const result = await executeStockDamagedTransaction(
    { item_id: ITEM_A, qty_pcs: 5, kategori: "SUPPLIER_RETURN", alasan: "RUSAK_KEMASAN", po_id: PO_ID },
    "user-1",
    client,
  );

  assert.equal(state.damaged.length, 1);
  assert.equal(state.damaged[0].status, "RETURNED_TO_SUPPLIER");
  assert.equal(result.purchase_return_error, null);

  assert.equal(state.returns.length, 1);
  assert.equal(Number(state.returns[0].total_potongan), 12500); // 5 x 2.500 harga PO
  assert.equal(state.returns[0].damaged_id, DAMAGED_ID);
  assert.equal(result.purchaseReturn.id, "ret-1");
});

test("temuan rusak tetap tersimpan walau nota retur tidak bisa diterbitkan", async () => {
  // PO belum punya penerimaan -> retur tidak sah.
  const { state, client } = createFakeTx({ po: buildPo({ goods_receipts: [] }) });

  const result = await executeStockDamagedTransaction(
    { item_id: ITEM_A, qty_pcs: 5, kategori: "SUPPLIER_RETURN", alasan: "RUSAK_KEMASAN", po_id: PO_ID },
    "user-1",
    client,
  );

  assert.equal(state.damaged.length, 1, "laporan rusak tetap dicatat");
  assert.equal(state.returns.length, 0);
  assert.equal(result.purchaseReturn, null);
  assert.match(result.purchase_return_error, /Belum ada penerimaan/);
});

test("INTERNAL_LOSS tidak membuat nota retur walau po_id dikirim", async () => {
  const { state, client } = createFakeTx();

  const result = await executeStockDamagedTransaction(
    { item_id: ITEM_A, qty_pcs: 2, kategori: "INTERNAL_LOSS", alasan: "HILANG", po_id: PO_ID },
    null,
    client,
  );

  assert.equal(state.damaged.length, 1);
  assert.equal(state.returns.length, 0);
  assert.equal(result.purchaseReturn, null);
  assert.equal(result.purchase_return_error, null);
});
