import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_RETURN_STATUSES,
  assertReturnAllowed,
  issuePurchaseReturn,
  sumReceivedGoodPcs,
  sumReturnedPcs,
} from "../../server/modules/purchasing/purchasing.return.js";

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
      {
        id: "gr-1",
        details: [
          { item_id: ITEM_A, qty_bagus_pcs: 60 },
          { item_id: ITEM_B, qty_bagus_pcs: 20 },
        ],
      },
      {
        id: "gr-2",
        details: [{ item_id: ITEM_A, qty_bagus_pcs: 40 }],
      },
    ],
    purchase_returns: [
      {
        id: "ret-1",
        status: "ISSUED",
        details: [{ item_id: ITEM_A, qty_pcs: 5 }],
      },
      {
        id: "ret-2",
        status: "CANCELLED",
        details: [{ item_id: ITEM_A, qty_pcs: 50 }],
      },
    ],
    ...overrides,
  };
}

test("sumReceivedGoodPcs dan sumReturnedPcs mengabaikan retur CANCELLED", () => {
  const po = buildPo();
  assert.equal(sumReceivedGoodPcs(po, ITEM_A), 100);
  assert.equal(sumReceivedGoodPcs(po, ITEM_B), 20);
  assert.equal(sumReturnedPcs(po, ITEM_A), 5);
  assert.equal(sumReturnedPcs(po, ITEM_A, { excludeReturnId: "ret-1" }), 0);
  assert.deepEqual(ACTIVE_RETURN_STATUSES, ["ISSUED", "MATCHED_INVOICE"]);
});

test("menerima retur dalam batas sisa barang diterima", () => {
  const po = buildPo();
  const result = assertReturnAllowed({ po, item_id: ITEM_A, qty_pcs: 95 });

  assert.equal(result.received, 100);
  assert.equal(result.returned, 5);
  assert.equal(result.remaining, 95);
  assert.equal(result.poDetail.harga_satuan, 2500);
});

test("menolak retur melebihi sisa diterima (P1 #6)", () => {
  const po = buildPo();
  assert.throws(
    () => assertReturnAllowed({ po, item_id: ITEM_A, qty_pcs: 96 }),
    (error) =>
      error.status === 400 &&
      /Sisa dapat diretur: 95 Pcs/.test(error.message) &&
      /Diminta: 96 Pcs/.test(error.message),
  );
});

test("menolak retur bila barang belum pernah diterima", () => {
  const po = buildPo({ goods_receipts: [] });
  assert.throws(
    () => assertReturnAllowed({ po, item_id: ITEM_A, qty_pcs: 1 }),
    (error) => error.status === 400 && /Belum ada penerimaan/.test(error.message),
  );
});

test("menolak retur untuk barang di luar PO", () => {
  const po = buildPo();
  assert.throws(
    () => assertReturnAllowed({ po, item_id: "item-luar", qty_pcs: 1 }),
    (error) => error.status === 400 && /tidak terdaftar pada PO/.test(error.message),
  );
});

test("menolak retur setelah invoice terbit", () => {
  const po = buildPo();
  assert.throws(
    () =>
      assertReturnAllowed({
        po,
        item_id: ITEM_A,
        qty_pcs: 1,
        invoice: { no_invoice: "SUP/2026/001" },
      }),
    (error) => error.status === 400 && /sudah terbit/.test(error.message),
  );
});

test("menolak retur pada PO CANCELLED dan qty tidak valid", () => {
  assert.throws(
    () => assertReturnAllowed({ po: buildPo({ status: "CANCELLED" }), item_id: ITEM_A, qty_pcs: 1 }),
    (error) => error.status === 400 && /dibatalkan/.test(error.message),
  );
  for (const qty of [0, -3, 1.5, "abc"]) {
    assert.throws(
      () => assertReturnAllowed({ po: buildPo(), item_id: ITEM_A, qty_pcs: qty }),
      (error) => error.status === 400,
    );
  }
});

test("issuePurchaseReturn memakai harga PO (bukan harga modal) dan menautkan damaged", async () => {
  const po = buildPo();
  const state = { created: [], damagedUpdates: [] };

  const tx = {
    t_purchase_order: { findUnique: async () => po },
    t_purchase_invoice: { findUnique: async () => null },
    t_stock_damaged: {
      findUnique: async () => ({ id: DAMAGED_ID, item_id: ITEM_A, qty_pcs: 10, status: "RECORDED", no_damaged: "DMG-1" }),
      update: async ({ where, data }) => {
        state.damagedUpdates.push({ where, data });
        return data;
      },
    },
    t_purchase_return: {
      findFirst: async () => null,
      create: async ({ data }) => {
        state.created.push(data);
        return { id: "ret-new", ...data };
      },
    },
  };

  const result = await issuePurchaseReturn(tx, {
    po_id: PO_ID,
    item_id: ITEM_A,
    qty_pcs: 8,
    damaged_id: DAMAGED_ID,
    user_id: "user-1",
  });

  assert.equal(state.created.length, 1);
  const data = state.created[0];
  assert.equal(data.status, "ISSUED");
  assert.equal(data.damaged_id, DAMAGED_ID);
  assert.equal(data.supplier_id, SUPPLIER_ID);
  assert.equal(Number(data.total_potongan), 20000); // 8 x 2.500 (harga PO)
  assert.equal(Number(data.details.create[0].harga_satuan_pcs), 2500);
  assert.equal(result.id, "ret-new");
  assert.deepEqual(state.damagedUpdates[0].data, { status: "RETURNED_TO_SUPPLIER" });
});

test("issuePurchaseReturn menolak damaged yang sudah dipakai retur lain", async () => {
  const po = buildPo();
  const tx = {
    t_purchase_order: { findUnique: async () => po },
    t_purchase_invoice: { findUnique: async () => null },
    t_stock_damaged: {
      findUnique: async () => ({ id: DAMAGED_ID, item_id: ITEM_A, qty_pcs: 10, status: "RECORDED" }),
    },
    t_purchase_return: {
      findFirst: async () => ({ no_retur: "RET-LAMA" }),
      create: async () => {
        throw new Error("tidak boleh dipanggil");
      },
    },
  };

  await assert.rejects(
    issuePurchaseReturn(tx, { po_id: PO_ID, item_id: ITEM_A, qty_pcs: 1, damaged_id: DAMAGED_ID }),
    (error) => error.status === 409 && /RET-LAMA/.test(error.message),
  );
});

test("issuePurchaseReturn menolak damaged dengan barang berbeda / qty berlebih", async () => {
  const po = buildPo();
  const makeTx = (damaged) => ({
    t_purchase_order: { findUnique: async () => po },
    t_purchase_invoice: { findUnique: async () => null },
    t_stock_damaged: { findUnique: async () => damaged },
    t_purchase_return: { findFirst: async () => null },
  });

  await assert.rejects(
    issuePurchaseReturn(makeTx({ id: DAMAGED_ID, item_id: ITEM_B, qty_pcs: 10 }), {
      po_id: PO_ID,
      item_id: ITEM_A,
      qty_pcs: 1,
      damaged_id: DAMAGED_ID,
    }),
    (error) => error.status === 400 && /berbeda/.test(error.message),
  );

  await assert.rejects(
    issuePurchaseReturn(makeTx({ id: DAMAGED_ID, item_id: ITEM_A, qty_pcs: 3 }), {
      po_id: PO_ID,
      item_id: ITEM_A,
      qty_pcs: 4,
      damaged_id: DAMAGED_ID,
    }),
    (error) => error.status === 400 && /qty barang rusak/.test(error.message),
  );
});

test("issuePurchaseReturn memvalidasi format id sebelum query", async () => {
  const tx = {};
  await assert.rejects(
    issuePurchaseReturn(tx, { po_id: "bukan-uuid", item_id: ITEM_A, qty_pcs: 1 }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    issuePurchaseReturn(tx, { po_id: PO_ID, item_id: "bukan-uuid", qty_pcs: 1 }),
    (error) => error.status === 400,
  );
});

test("issuePurchaseReturn menolak saat invoice PO sudah terbit", async () => {
  const po = buildPo();
  const tx = {
    t_purchase_order: { findUnique: async () => po },
    t_purchase_invoice: { findUnique: async () => ({ no_invoice: "SUP/1" }) },
  };

  await assert.rejects(
    issuePurchaseReturn(tx, { po_id: PO_ID, item_id: ITEM_A, qty_pcs: 1 }),
    (error) => error.status === 400 && /sudah terbit/.test(error.message),
  );
});
