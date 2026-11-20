import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlanForStoredItem,
  syncAllBelowRopAutoPrs,
  syncAutoPrForItem,
} from "../../server/modules/purchasing/autoPr.helper.js";

function makeItem({
  id = "item-1",
  is_active = true,
  stockQty = 0,
  rop_pcs = 12,
  safety_stock_pcs = 12,
  lead_time_days = 3,
  avg_daily_sales = 0,
  max_stock_pcs = 120,
  is_auto_pr = true,
  rasio_konversi = 24,
  supplier_id = "sup-1",
} = {}) {
  return {
    id,
    is_active,
    nama_barang: "Teh Botol Sosro 450ml",
    stocks: [{ location: "GUDANG", qty: stockQty }],
    uom: { rasio_konversi },
    rop_setting: {
      lead_time_days,
      safety_stock_pcs,
      avg_daily_sales,
      rop_pcs,
      max_stock_pcs,
      is_auto_pr,
    },
    supplier_catalogs: supplier_id ? [{ supplier_id, harga_modal: 3500 }] : [],
  };
}

function createFakeSyncClient({
  items = [],
  pendingPrs = [],
  activePoDetails = [],
} = {}) {
  const createdPrs = [];
  const updatedPrCalls = [];

  const tx = {
    $executeRaw: async () => 1,
    t_purchase_req: {
      findFirst: async ({ where }) =>
        pendingPrs.find((p) => p.item_id === where.item_id && p.status === where.status) ||
        createdPrs.find((p) => p.item_id === where.item_id && p.status === where.status) ||
        null,
      create: async ({ data }) => {
        const record = { id: `pr-${createdPrs.length + 1}`, ...data };
        createdPrs.push(record);
        return record;
      },
    },
    t_purchase_order: {
      findFirst: async ({ where }) => {
        const itemId = where.details?.some?.item_id;
        return activePoDetails.find((d) => d.item_id === itemId) ? { id: "po-1" } : null;
      },
    },
  };

  const client = {
    $transaction: async (fn) => fn(tx),
    m_item: {
      findUnique: async ({ where }) => items.find((i) => i.id === where.id) || null,
      findMany: async ({ where } = {}) =>
        items.filter((i) => {
          if (where?.is_active !== undefined && i.is_active !== where.is_active) return false;
          if (where?.rop_setting?.isNot === null && !i.rop_setting) return false;
          return true;
        }),
    },
    t_purchase_req: {
      findFirst: tx.t_purchase_req.findFirst,
      findMany: async () => pendingPrs,
      updateMany: async (args) => {
        updatedPrCalls.push(args);
        return { count: 1 };
      },
    },
    t_purchase_order: tx.t_purchase_order,
    t_purchase_order_d: {
      findMany: async () => activePoDetails,
    },
  };

  return { client, createdPrs, updatedPrCalls };
}

test("buildPlanForStoredItem memakai rop_pcs tersimpan, bukan hasil hitung ulang", () => {
  const item = makeItem({
    stockQty: 20,
    rop_pcs: 25,
    avg_daily_sales: 5,
    lead_time_days: 3,
    safety_stock_pcs: 10,
    max_stock_pcs: 150,
    rasio_konversi: 40,
  });

  const plan = buildPlanForStoredItem(item);
  assert.equal(plan.ropPcs, 25);
  assert.equal(plan.computedRopPcs, 25);
  assert.equal(plan.status, "RESTOCK");
  assert.equal(plan.needsRestock, true);
  assert.equal(plan.qtySaranBeli, 4);
  assert.equal(plan.qtySaranPcs, 160);
});

test("buildPlanForStoredItem menandai Mendekati ROP sebagai perlu restock", () => {
  const item = makeItem({ stockQty: 45, rop_pcs: 40, max_stock_pcs: 120 });

  const plan = buildPlanForStoredItem(item);
  // Batas warning = ceil(40 * 1.25) = 50
  assert.equal(plan.warningLimit, 50);
  assert.equal(plan.status, "WARNING");
  assert.equal(plan.needsRestock, true);
});

test("buildPlanForStoredItem menganggap stok di atas batas warning aman", () => {
  const item = makeItem({ stockQty: 51, rop_pcs: 40, max_stock_pcs: 120 });

  const plan = buildPlanForStoredItem(item);
  assert.equal(plan.status, "SAFE");
  assert.equal(plan.needsRestock, false);
});

test("syncAutoPrForItem otomatis membuat Auto-PR saat barang baru stok 0 <= ROP", async () => {
  const item = makeItem({ id: "item-sosro", stockQty: 0, safety_stock_pcs: 12 });
  const { client, createdPrs } = createFakeSyncClient({ items: [item] });

  const pr = await syncAutoPrForItem(client, "item-sosro");
  assert.ok(pr);
  assert.equal(createdPrs.length, 1);
  assert.equal(createdPrs[0].item_id, "item-sosro");
  assert.equal(createdPrs[0].supplier_id, "sup-1");
  assert.equal(createdPrs[0].qty_saran_pcs, 120);
  assert.equal(createdPrs[0].qty_saran_beli, 5);
});

test("syncAutoPrForItem membatalkan Auto-PR lama jika stok sudah di atas ROP", async () => {
  const item = makeItem({ id: "item-sosro", stockQty: 50, safety_stock_pcs: 12 });
  const { client, createdPrs, updatedPrCalls } = createFakeSyncClient({ items: [item] });

  const pr = await syncAutoPrForItem(client, "item-sosro");
  assert.equal(pr, null);
  assert.equal(createdPrs.length, 0);
  assert.equal(updatedPrCalls.length, 1);
  assert.equal(updatedPrCalls[0].data.status, "CANCELLED");
});

test("syncAllBelowRopAutoPrs membuat PR hanya untuk item non-Aman tanpa PO aktif dan menutup PR stale", async () => {
  const itemKritis = makeItem({ id: "item-kritis", stockQty: 0, safety_stock_pcs: 12 });
  const itemAdaPo = makeItem({ id: "item-po", stockQty: 0, safety_stock_pcs: 10 });
  const itemAman = makeItem({ id: "item-aman", stockQty: 80, safety_stock_pcs: 10 });
  const itemTanpaRop = makeItem({ id: "item-tanpa-rop", stockQty: 0 });
  itemTanpaRop.rop_setting = null;

  const { client, createdPrs, updatedPrCalls } = createFakeSyncClient({
    items: [itemKritis, itemAdaPo, itemAman, itemTanpaRop],
    pendingPrs: [{ item_id: "item-aman", status: "PENDING" }],
    activePoDetails: [
      {
        item_id: "item-po",
        po: { id: "po-1", no_po: "PO-001", status: "ORDERED", createdAt: new Date() },
      },
    ],
  });

  const result = await syncAllBelowRopAutoPrs(client);
  assert.equal(result.created.length, 1);
  assert.equal(createdPrs[0].item_id, "item-kritis");
  assert.equal(result.waiting.length, 1);
  assert.equal(result.waiting[0].item.id, "item-po");
  assert.equal(result.waiting[0].activePo.no_po, "PO-001");
  assert.equal(updatedPrCalls.some((c) => c.data.status === "CANCELLED"), true);
});

test("syncAllBelowRopAutoPrs mengusulkan barang berstatus Mendekati ROP", async () => {
  const itemWarning = makeItem({ id: "item-warning", stockQty: 45, rop_pcs: 40 });
  const { client, createdPrs } = createFakeSyncClient({ items: [itemWarning] });

  const result = await syncAllBelowRopAutoPrs(client);
  assert.equal(result.created.length, 1);
  assert.equal(createdPrs[0].item_id, "item-warning");
  assert.equal(createdPrs[0].rop_threshold, 40);
});

test("syncAllBelowRopAutoPrs tidak mengusulkan barang tanpa setting ROP", async () => {
  const itemTanpaRop = makeItem({ id: "item-tanpa-rop", stockQty: 0 });
  itemTanpaRop.rop_setting = null;

  const { client, createdPrs } = createFakeSyncClient({ items: [itemTanpaRop] });
  const result = await syncAllBelowRopAutoPrs(client);
  assert.equal(result.created.length, 0);
  assert.equal(createdPrs.length, 0);
});
