import test from "node:test";
import assert from "node:assert/strict";
import {
  computeThreeWayMatching,
  MATCHING_RETURN_STATUSES,
} from "../../server/modules/purchasing/purchasing.matching.js";

// Fixture: 1 PO berisi 2 barang, 2 Goods Receipt, dan 3 retur
// (2 dihitung: ISSUED & MATCHED_INVOICE, 1 diabaikan: CANCELLED).
function buildFixture() {
  return {
    id: "po-1",
    no_po: "PO-001",
    status: "COMPLETED",
    supplier: {
      id: "sup-1",
      nama_supplier: "PT Sumber Rejeki",
      term_of_payment: 30,
    },
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
        details: [{ item_id: "item-a", qty_pcs: 10 }],
      },
      {
        id: "ret-2",
        status: "MATCHED_INVOICE",
        details: [{ item_id: "item-b", qty_pcs: 5 }],
      },
      {
        id: "ret-3",
        status: "CANCELLED",
        details: [{ item_id: "item-a", qty_pcs: 999 }],
      },
    ],
  };
}

test("menghitung agregat seluruh GR dan retur untuk satu PO", () => {
  const result = computeThreeWayMatching(buildFixture());

  assert.equal(result.po_id, "po-1");
  assert.equal(result.no_po, "PO-001");
  assert.equal(result.has_receipts, true);
  assert.equal(result.summary_verifikasi.jumlah_goods_receipt, 2);
  assert.equal(result.summary_verifikasi.jumlah_retur, 2, "retur CANCELLED tidak dihitung");

  const itemA = result.matching_lines.find((line) => line.item_id === "item-a");
  const itemB = result.matching_lines.find((line) => line.item_id === "item-b");

  // Item A: order 100, diterima bagus 60+40=100, retur 10 -> bersih 90.
  assert.equal(itemA.bukti_1_pesanan.qty_pcs, 100);
  assert.equal(itemA.bukti_1_pesanan.subtotal, 250000);
  assert.equal(itemA.bukti_2_terima_gudang.qty_bagus_pcs, 100);
  assert.equal(itemA.bukti_2_terima_gudang.qty_reject_pcs, 5);
  assert.equal(itemA.bukti_2_terima_gudang.subtotal, 250000);
  assert.equal(itemA.bukti_3_retur_gudang.qty_retur_pcs, 10);
  assert.equal(itemA.bukti_3_retur_gudang.subtotal_potongan, 25000);
  assert.equal(itemA.kalkulasi_bersih.qty_bersih_pcs, 90);
  assert.equal(itemA.kalkulasi_bersih.nominal_bersih_bayar, 225000);

  // Item B: order 50, diterima bagus 40+10=50, retur 5 -> bersih 45.
  assert.equal(itemB.bukti_2_terima_gudang.qty_bagus_pcs, 50);
  assert.equal(itemB.bukti_3_retur_gudang.qty_retur_pcs, 5);
  assert.equal(itemB.kalkulasi_bersih.qty_bersih_pcs, 45);
  assert.equal(itemB.kalkulasi_bersih.nominal_bersih_bayar, 45000);

  // Ringkasan: gross diterima 300.000, potongan 30.000, bersih 270.000.
  assert.equal(result.summary_verifikasi.total_pesanan_awal_po, 300000);
  assert.equal(result.summary_verifikasi.total_bukti_masuk_bagus_gr, 300000);
  assert.equal(result.summary_verifikasi.total_potongan_nota_retur, 30000);
  assert.equal(result.summary_verifikasi.total_bersih_dikunci, 270000);

  // Semua GR dan retur yang dihitung ikut terdaftar (bukan hanya satu dokumen).
  assert.deepEqual(result.gr_ids, ["gr-1", "gr-2"]);
  assert.deepEqual(result.return_ids, ["ret-1", "ret-2"]);
  assert.deepEqual(result.return_ids_issued, ["ret-1"]);
});

test("preview tetap stabil setelah retur tercocokkan ke invoice", () => {
  const fixture = buildFixture();
  const before = computeThreeWayMatching(fixture);

  // Simulasikan invoice sudah terbit: semua retur ISSUED -> MATCHED_INVOICE.
  for (const retur of fixture.purchase_returns) {
    if (retur.status === "ISSUED") retur.status = "MATCHED_INVOICE";
  }
  const after = computeThreeWayMatching(fixture);

  assert.deepEqual(
    after.summary_verifikasi,
    before.summary_verifikasi,
    "nominal tidak boleh berubah setelah invoice terbit",
  );
  assert.deepEqual(after.return_ids_issued, []);
  assert.deepEqual(after.return_ids, ["ret-1", "ret-2"]);
});

test("menandai barang GR/retur yang tidak terdaftar di PO", () => {
  const fixture = buildFixture();
  fixture.goods_receipts[0].details.push({
    item_id: "item-x",
    qty_bagus_pcs: 5,
    qty_ditolak_pcs: 0,
  });
  fixture.purchase_returns[0].details.push({ item_id: "item-y", qty_pcs: 3 });

  const result = computeThreeWayMatching(fixture);
  assert.deepEqual(result.unmatched_receipt_item_ids, ["item-x"]);
  assert.deepEqual(result.unmatched_return_item_ids, ["item-y"]);
});

test("tidak menghasilkan nominal bersih negatif saat retur melebihi penerimaan", () => {
  const fixture = buildFixture();
  // Item A diterima 100 pcs, diretur 105 pcs -> baris A di-clamp ke 0.
  fixture.purchase_returns[0].details[0].qty_pcs = 105;

  const result = computeThreeWayMatching(fixture);
  const itemA = result.matching_lines.find((line) => line.item_id === "item-a");

  assert.equal(itemA.kalkulasi_bersih.qty_bersih_pcs, 0);
  assert.equal(itemA.kalkulasi_bersih.nominal_bersih_bayar, 0);
  // Gross 300.000 - potongan (105 x 2.500 + 5 x 1.000) = 32.500, tidak negatif.
  assert.equal(result.summary_verifikasi.total_bersih_dikunci, 32500);
});

test("PO tanpa GR ditandai has_receipts=false", () => {
  const fixture = buildFixture();
  fixture.goods_receipts = [];

  const result = computeThreeWayMatching(fixture);
  assert.equal(result.has_receipts, false);
  assert.equal(result.summary_verifikasi.total_bukti_masuk_bagus_gr, 0);
  assert.equal(result.summary_verifikasi.total_bersih_dikunci, 0);
});

test("status retur yang dihitung hanya ISSUED dan MATCHED_INVOICE", () => {
  assert.deepEqual(MATCHING_RETURN_STATUSES, ["ISSUED", "MATCHED_INVOICE"]);
});

test("melempar 404 jika PO tidak ada", () => {
  assert.throws(
    () => computeThreeWayMatching(null),
    (error) => error.status === 404,
  );
});
