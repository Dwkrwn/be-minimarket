import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReceiptLines,
  evaluatePoFulfillment,
} from "../../server/modules/purchasing/purchasing.receipt.js";

const PO = {
  id: "po-1",
  no_po: "PO-001",
  details: [
    { item_id: "item-a", qty_order_pcs: 100, harga_satuan: 2500 },
    { item_id: "item-b", qty_order_pcs: 50, harga_satuan: 1000 },
  ],
};

const MASTER_ITEMS = {
  "item-a": {
    id: "item-a",
    nama_barang: "Beras 1kg",
    category_rack_id: "rack-1",
    uom_id: "uom-dus",
    uom: { id: "uom-dus", rasio_konversi: 12 },
  },
  "item-b": {
    id: "item-b",
    nama_barang: "Gula 250g",
    category_rack_id: "rack-2",
    uom_id: null,
    uom: null,
  },
};

const UOMS = {
  "uom-dus": { id: "uom-dus", rasio_konversi: 12 },
  "uom-pack": { id: "uom-pack", rasio_konversi: 6 },
};

function build(overrides = {}) {
  return buildReceiptLines({
    po: PO,
    items: [
      { item_id: "item-a", qty_diterima_beli: 5, qty_ditolak_pcs: 2 },
      { item_id: "item-b", qty_bagus_pcs: 40, qty_ditolak_pcs: 0 },
    ],
    masterItems: MASTER_ITEMS,
    uoms: UOMS,
    receivedQtyByItem: new Map(),
    ...overrides,
  });
}

test("mengonversi qty beli ke Pcs dan memakai harga PO", () => {
  const lines = build();

  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], {
    item_id: "item-a",
    uom_id: "uom-dus",
    qty_diterima_beli: 5,
    qty_bagus_pcs: 60, // 5 dus x 12
    qty_ditolak_pcs: 2,
    harga_satuan_pcs: 2500,
    subtotal: 150000,
  });
  assert.equal(lines[1].qty_bagus_pcs, 40);
  assert.equal(lines[1].harga_satuan_pcs, 1000);
  assert.equal(lines[1].subtotal, 40000);
});

test("menghormati uom_id yang dikirim pada baris", () => {
  const lines = build({
    items: [{ item_id: "item-a", qty_diterima_beli: 2, uom_id: "uom-pack" }],
  });
  assert.equal(lines[0].uom_id, "uom-pack");
  assert.equal(lines[0].qty_bagus_pcs, 12); // 2 pack x 6
});

test("menolak barang yang tidak terdaftar di PO", () => {
  assert.throws(
    () => build({ items: [{ item_id: "item-luar", qty_bagus_pcs: 5 }] }),
    (error) => error.status === 400 && /tidak terdaftar pada PO/.test(error.message),
  );
});

test("menolak qty negatif dan qty bukan bilangan bulat", () => {
  assert.throws(
    () => build({ items: [{ item_id: "item-a", qty_bagus_pcs: -5 }] }),
    (error) => error.status === 400 && /bilangan bulat >= 0/.test(error.message),
  );
  assert.throws(
    () => build({ items: [{ item_id: "item-a", qty_bagus_pcs: 2.5 }] }),
    (error) => error.status === 400 && /bilangan bulat >= 0/.test(error.message),
  );
  assert.throws(
    () => build({ items: [{ item_id: "item-a", qty_ditolak_pcs: -1, qty_bagus_pcs: 1 }] }),
    (error) => error.status === 400 && /Qty ditolak/.test(error.message),
  );
});

test("menolak barang yang muncul dua kali dalam satu penerimaan", () => {
  assert.throws(
    () =>
      build({
        items: [
          { item_id: "item-a", qty_bagus_pcs: 1 },
          { item_id: "item-a", qty_bagus_pcs: 2 },
        ],
      }),
    (error) => error.status === 400 && /lebih dari sekali/.test(error.message),
  );
});

test("menolak penerimaan kumulatif melebihi qty PO", () => {
  assert.throws(
    () =>
      build({
        items: [{ item_id: "item-a", qty_bagus_pcs: 30 }],
        receivedQtyByItem: new Map([["item-a", 80]]),
      }),
    (error) => error.status === 400 && /melebihi jumlah PO/.test(error.message),
  );

  // Tepat sama dengan qty PO tetap diterima.
  const lines = build({
    items: [{ item_id: "item-a", qty_bagus_pcs: 20 }],
    receivedQtyByItem: new Map([["item-a", 80]]),
  });
  assert.equal(lines[0].qty_bagus_pcs, 20);
});

test("menolak baris kosong dan penerimaan tanpa barang bagus", () => {
  assert.throws(
    () => build({ items: [{ item_id: "item-a", qty_bagus_pcs: 0, qty_ditolak_pcs: 0 }] }),
    (error) => error.status === 400 && /tidak berisi qty bagus/.test(error.message),
  );
  assert.throws(
    () => build({ items: [{ item_id: "item-a", qty_bagus_pcs: 0, qty_ditolak_pcs: 3 }] }),
    (error) => error.status === 400 && /Tidak ada barang bagus/.test(error.message),
  );
});

test("menolak UOM yang tidak dikenal", () => {
  assert.throws(
    () => build({ items: [{ item_id: "item-a", qty_bagus_pcs: 1, uom_id: "uom-x" }] }),
    (error) => error.status === 400 && /UOM/.test(error.message),
  );
});

test("evaluatePoFulfillment: PARTIAL lalu COMPLETED", () => {
  const partial = evaluatePoFulfillment(PO, [
    {
      details: [
        { item_id: "item-a", qty_bagus_pcs: 100 },
        { item_id: "item-b", qty_bagus_pcs: 49 },
      ],
    },
  ]);
  assert.equal(partial, "PARTIAL_RECEIVED");

  const completed = evaluatePoFulfillment(PO, [
    { details: [{ item_id: "item-a", qty_bagus_pcs: 60 }] },
    {
      details: [
        { item_id: "item-a", qty_bagus_pcs: 40 },
        { item_id: "item-b", qty_bagus_pcs: 50 },
      ],
    },
  ]);
  assert.equal(completed, "COMPLETED");
});
