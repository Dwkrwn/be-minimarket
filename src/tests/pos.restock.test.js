import test from "node:test";
import assert from "node:assert/strict";
import {
  RESTOCK_WARNING_RATIO,
  computeRestockPlan,
  computeRestockStatus,
  parseBooleanFlag,
  parseWindowDays,
} from "../../server/modules/pos/pos.restock.js";

test("computeRestockStatus membagi RESTOCK, WARNING, dan SAFE sesuai halaman ROP", () => {
  // Batas warning = ceil(rop * 1.25)
  assert.equal(RESTOCK_WARNING_RATIO, 1.25);

  // stok tepat di ROP -> RESTOCK
  assert.deepEqual(computeRestockStatus(40, 40).key, "RESTOCK");
  // stok di atas ROP tetapi masih <= 1.25x -> WARNING
  assert.equal(computeRestockStatus(41, 40).key, "WARNING");
  assert.equal(computeRestockStatus(50, 40).key, "WARNING");
  // stok di atas batas warning -> SAFE
  assert.equal(computeRestockStatus(51, 40).key, "SAFE");

  // rop = 0: hanya RESTOCK saat stok <= 0, WARNING tidak pernah aktif
  assert.equal(computeRestockStatus(0, 0).key, "RESTOCK");
  assert.equal(computeRestockStatus(1, 0).key, "SAFE");

  assert.equal(computeRestockStatus(41, 40).needsRestock, true);
  assert.equal(computeRestockStatus(51, 40).needsRestock, false);
});

test('parseBooleanFlag: string "false" dari query tidak lagi dianggap true (P1 #7)', () => {
  assert.equal(parseBooleanFlag("false"), false);
  assert.equal(parseBooleanFlag("FALSE"), false);
  assert.equal(parseBooleanFlag("0"), false);
  assert.equal(parseBooleanFlag("no"), false);
  assert.equal(parseBooleanFlag("true"), true);
  assert.equal(parseBooleanFlag("1"), true);
  assert.equal(parseBooleanFlag(true), true);
  assert.equal(parseBooleanFlag(false), false);
  assert.equal(parseBooleanFlag(undefined), true);
  assert.equal(parseBooleanFlag(undefined, false), false);
  assert.equal(parseBooleanFlag("", false), false);
});

test("parseWindowDays memvalidasi periode rekap", () => {
  assert.equal(parseWindowDays(undefined), 7);
  assert.equal(parseWindowDays("14"), 14);
  assert.equal(parseWindowDays(1), 1);

  for (const value of ["abc", 0, -5, 2.5, 400]) {
    assert.throws(
      () => parseWindowDays(value),
      (error) => error.status === 400 && /days_window/.test(error.message),
    );
  }
});

function buildItem(overrides = {}) {
  return {
    id: "item-a",
    nama_barang: "Beras 1kg",
    rop_setting: {
      lead_time_days: 3,
      safety_stock_pcs: 10,
      max_stock_pcs: 100,
      is_auto_pr: true,
    },
    stocks: [
      { location: "GUDANG", qty: 5 },
      { location: "RAK", qty: 10 },
    ],
    uom: { rasio_konversi: 12 },
    ...overrides,
  };
}

test("computeRestockPlan menghitung ROP, status stok, dan saran beli", () => {
  // avg = 70 / 7 = 10/hari; ROP = 10 x 3 + 10 = 40; stok = 15 <= 40.
  const plan = computeRestockPlan({ item: buildItem(), totalSoldPcs: 70, windowDays: 7 });

  assert.equal(plan.avgDailySales, 10);
  assert.equal(plan.ropPcs, 40);
  assert.equal(plan.totalCurrentStock, 15);
  assert.equal(plan.isBelowRop, true);
  assert.equal(plan.autoPrEnabled, true);

  // needed = max(100-15, 40*2) = 85 -> 85/12 = 7.08 -> 8 dus = 96 pcs
  assert.equal(plan.qtySaranBeli, 8);
  assert.equal(plan.qtySaranPcs, 96);
});

test("computeRestockPlan: stok di atas ROP tidak memicu restock", () => {
  const plan = computeRestockPlan({
    item: buildItem({ stocks: [{ location: "GUDANG", qty: 100 }, { location: "RAK", qty: 50 }] }),
    totalSoldPcs: 70,
    windowDays: 7,
  });
  assert.equal(plan.totalCurrentStock, 150);
  assert.equal(plan.isBelowRop, false);
});

test("computeRestockPlan menghormati is_auto_pr = false", () => {
  const plan = computeRestockPlan({
    item: buildItem({
      rop_setting: {
        lead_time_days: 3,
        safety_stock_pcs: 10,
        max_stock_pcs: 100,
        is_auto_pr: false,
      },
    }),
    totalSoldPcs: 70,
    windowDays: 7,
  });

  assert.equal(plan.isBelowRop, true);
  assert.equal(plan.autoPrEnabled, false, "Auto-PR harus nonaktif untuk barang ini");
});

test("computeRestockPlan memakai default saat belum ada setting ROP", () => {
  const plan = computeRestockPlan({
    item: buildItem({ rop_setting: null, uom: null }),
    totalSoldPcs: 0,
    windowDays: 7,
  });

  assert.equal(plan.leadTime, 3);
  assert.equal(plan.safetyStock, 10);
  assert.equal(plan.maxStock, 100);
  assert.equal(plan.ropPcs, 10);
  assert.equal(plan.autoPrEnabled, true);
  assert.equal(plan.conversionRatio, 1);
});
