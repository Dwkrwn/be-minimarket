import test from "node:test";
import assert from "node:assert/strict";
import {
  getGoodsReceiptDetail,
  getSupplierDetail,
  listGoodsReceipts,
} from "../../server/modules/purchasing/purchasing.service.js";

const GR_ID = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID = "22222222-2222-4222-8222-222222222222";

function buildReceipt(overrides = {}) {
  return {
    id: GR_ID,
    no_gr: "GR-001",
    no_surat_jalan: "SJ-001",
    status: "RECEIVED",
    po: { id: "po-1", no_po: "PO-001", supplier: { nama_supplier: "PT Sumber Rejeki" } },
    details: [
      { item_id: "item-a", qty_bagus_pcs: 40, qty_ditolak_pcs: 2 },
      { item_id: "item-b", qty_bagus_pcs: 10, qty_ditolak_pcs: 0 },
    ],
    ...overrides,
  };
}

function createFakeClient({ receipts = [buildReceipt()], receipt = buildReceipt(), supplier = null } = {}) {
  const calls = { findMany: [], findUnique: [] };
  return {
    calls,
    t_goods_receipt: {
      findMany: async (args) => {
        calls.findMany.push(args);
        return receipts;
      },
      findUnique: async (args) => {
        calls.findUnique.push(args);
        return receipt;
      },
    },
    m_supplier: {
      findUnique: async () => supplier,
    },
  };
}

test("listGoodsReceipts menghitung total bagus dan ditolak", async () => {
  const client = createFakeClient();
  const rows = await listGoodsReceipts({}, client);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].total_item, 2);
  assert.equal(rows[0].total_qty_bagus_pcs, 50);
  assert.equal(rows[0].total_qty_ditolak_pcs, 2);
  assert.match(rows[0].status_label, /Diterima/);
});

test("listGoodsReceipts menerjemahkan filter supplier dan search ke query", async () => {
  const client = createFakeClient();
  await listGoodsReceipts({ supplier_id: SUPPLIER_ID, status: "RECEIVED" }, client);

  const args = client.calls.findMany[0];
  assert.equal(args.where.status, "RECEIVED");
  assert.equal(args.where.po.supplier_id, SUPPLIER_ID);
});

test("listGoodsReceipts menyaring nomor GR / surat jalan saat search diisi", async () => {
  const client = createFakeClient();
  await listGoodsReceipts({ search: "GR-001" }, client);

  const args = client.calls.findMany[0];
  assert.equal(args.where.OR.length, 2);
  assert.equal(args.where.OR[0].no_gr.contains, "GR-001");
});

test("getGoodsReceiptDetail mengembalikan total qty bagus dan ditolak", async () => {
  const client = createFakeClient();
  const detail = await getGoodsReceiptDetail(GR_ID, client);

  assert.equal(detail.id, GR_ID);
  assert.equal(detail.total_qty_bagus_pcs, 50);
  assert.equal(detail.total_qty_ditolak_pcs, 2);
});

test("getGoodsReceiptDetail 404 saat dokumen tidak ada", async () => {
  const client = createFakeClient({ receipt: null });
  await assert.rejects(() => getGoodsReceiptDetail(GR_ID, client), (error) => {
    assert.equal(error.status, 404);
    return true;
  });
});

test("getSupplierDetail mengembalikan supplier lengkap", async () => {
  const client = createFakeClient({
    supplier: { id: SUPPLIER_ID, nama_supplier: "PT Sumber Rejeki", catalogs: [] },
  });
  const supplier = await getSupplierDetail(SUPPLIER_ID, client);
  assert.equal(supplier.nama_supplier, "PT Sumber Rejeki");
});

test("getSupplierDetail 404 saat supplier tidak ada", async () => {
  const client = createFakeClient({ supplier: null });
  await assert.rejects(() => getSupplierDetail(SUPPLIER_ID, client), (error) => {
    assert.equal(error.status, 404);
    return true;
  });
});
