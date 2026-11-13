import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCheckoutShift,
  assertShiftAccess,
  assertShiftReportAccess,
  isShiftOwner,
  projectActiveShift,
} from "../../server/modules/pos/pos.shift.js";
import {
  closeCashierShift,
  executePosCheckoutTransaction,
  getShiftReport,
} from "../../server/modules/pos/pos.service.js";

const KASIR = { id: "user-kasir", role: { system_key: "KASIR" } };
const KASIR_LAIN = { id: "user-lain", role: { system_key: "KASIR" } };
const ADMIN = { id: "user-admin", role: { system_key: "ADMIN" } };

function buildShift(overrides = {}) {
  return {
    id: "shift-1",
    no_shift: "SFT-001",
    user_id: KASIR.id,
    status: "OPEN",
    modal_awal: 100000,
    total_tunai: 25000,
    total_non_tunai: 0,
    uang_fisik_laci: null,
    selisih: null,
    catatan: null,
    orders: [],
    user: { id: KASIR.id, name: "Kasir Satu" },
    ...overrides,
  };
}

test("isShiftOwner hanya true untuk pemilik shift", () => {
  const shift = buildShift();
  assert.equal(isShiftOwner(shift, KASIR), true);
  assert.equal(isShiftOwner(shift, KASIR_LAIN), false);
  assert.equal(isShiftOwner(shift, null), false);
});

test("assertShiftAccess menolak kasir lain dan mengizinkan pemilik (P2 #10)", () => {
  const shift = buildShift();

  assert.equal(assertShiftAccess(shift, KASIR), shift);
  assert.throws(
    () => assertShiftAccess(shift, KASIR_LAIN),
    (error) =>
      error.status === 403 &&
      /tidak berhak mengakses shift kasir milik kasir lain/.test(error.message),
  );
});

test("assertShiftAccess mengizinkan Admin untuk oversight", () => {
  const shift = buildShift();
  assert.equal(assertShiftAccess(shift, ADMIN), shift);
});

test("assertShiftAccess menolak shift yang tidak ada", () => {
  assert.throws(
    () => assertShiftAccess(null, KASIR),
    (error) => error.status === 404,
  );
});

test("assertCheckoutShift mewajibkan shift OPEN dan milik kasir sendiri", () => {
  assert.throws(
    () => assertCheckoutShift(buildShift({ status: "CLOSED" }), KASIR),
    (error) => error.status === 400 && /sudah ditutup/.test(error.message),
  );
  assert.throws(
    () => assertCheckoutShift(buildShift(), KASIR_LAIN),
    (error) => error.status === 403,
  );
  assert.throws(
    () => assertCheckoutShift(buildShift(), ADMIN),
    (error) => error.status === 403,
    "Admin tidak boleh mencatat penjualan ke shift kasir lain",
  );
});

test("checkout menolak shift milik kasir lain sebelum menyentuh transaksi", async () => {
  const created = [];
  const tx = {
    t_cashier_shift: {
      findUnique: async () => buildShift(),
      update: async () => ({}),
    },
    t_pos_order: {
      create: async ({ data }) => {
        created.push(data);
        return data;
      },
    },
  };
  const client = { $transaction: async (fn) => fn(tx) };

  await assert.rejects(
    executePosCheckoutTransaction(
      { shift_id: "shift-1", items: [{ item_id: "item-1", qty_pcs: 1 }], bayar: 10000 },
      KASIR_LAIN,
      client,
    ),
    (error) => error.status === 403,
  );

  assert.equal(created.length, 0, "tidak ada order yang boleh dibuat");
});

test("tutup shift menolak kasir lain dan tidak mengubah data", async () => {
  const updates = [];
  const tx = {
    t_cashier_shift: {
      findUnique: async () => buildShift(),
      update: async (args) => {
        updates.push(args);
        return buildShift({ status: "CLOSED" });
      },
    },
  };
  const client = { $transaction: async (fn) => fn(tx) };

  await assert.rejects(
    closeCashierShift("shift-1", { uang_fisik_laci: 125000 }, KASIR_LAIN, client),
    (error) => error.status === 403 && /menutup/.test(error.message),
  );

  assert.equal(updates.length, 0);
});

test("tutup shift oleh pemilik menghitung rekonsiliasi kas", async () => {
  const tx = {
    t_cashier_shift: {
      findUnique: async () => buildShift(),
      update: async ({ data }) => ({ ...buildShift(), ...data }),
    },
  };
  const client = { $transaction: async (fn) => fn(tx) };

  // Ekspektasi laci = 100.000 + 25.000 = 125.000.
  const result = await closeCashierShift(
    "shift-1",
    { uang_fisik_laci: 120000 },
    KASIR,
    client,
  );

  assert.equal(result.ekspektasi_kas_laci, 125000);
  assert.equal(result.selisih, -5000);
  assert.equal(result.status_rekonsiliasi, "KURANG_KAS");
  assert.equal(result.status, "CLOSED");
});

test("laporan shift hanya untuk pemilik atau Admin", async () => {
  const reportShift = buildShift({
    status: "CLOSED",
    orders: [{ status: "COMPLETED", total_amount: 25000, metode_bayar: "TUNAI" }],
  });
  const client = {
    t_cashier_shift: { findUnique: async () => reportShift },
  };

  await assert.rejects(
    getShiftReport("shift-1", KASIR_LAIN, client),
    (error) => error.status === 403 && /melihat laporan/.test(error.message),
  );

  const own = await getShiftReport("shift-1", KASIR, client);
  assert.equal(own.shift_id, "shift-1");
  assert.equal(own.kasir, "Kasir Satu");
  assert.equal(own.rekonsiliasi_kas.ekspektasi_kas_laci, 125000);

  const adminView = await getShiftReport("shift-1", ADMIN, client);
  assert.equal(adminView.shift_id, "shift-1");
});

test("kasir tidak boleh melihat laporan shift yang masih OPEN (blind closing)", async () => {
  const client = {
    t_cashier_shift: {
      findUnique: async () => buildShift({ status: "OPEN" }),
    },
  };

  await assert.rejects(
    getShiftReport("shift-1", KASIR, client),
    (error) => error.status === 403 && /setelah shift kasir ditutup/.test(error.message),
  );

  // Admin tetap boleh melihat rekap shift berjalan untuk oversight.
  const adminView = await getShiftReport("shift-1", ADMIN, client);
  assert.equal(adminView.status, "OPEN");
});

test("projectActiveShift menyembunyikan omzet & order dari kasir", () => {
  const shift = buildShift({ orders: [{ id: "order-1" }] });

  const kasirView = projectActiveShift(shift, KASIR);
  assert.equal(kasirView.id, shift.id);
  assert.equal(kasirView.modal_awal, 100000);
  assert.equal("orders" in kasirView, false, "daftar order tidak boleh bocor");
  assert.equal("total_tunai" in kasirView, false, "akumulasi tunai tidak boleh bocor");
  assert.equal("total_non_tunai" in kasirView, false);

  const adminView = projectActiveShift(shift, ADMIN);
  assert.equal(adminView.orders.length, 1);
  assert.equal(adminView.total_tunai, 25000);
});

test("assertShiftReportAccess menolak shift OPEN untuk non-manager", () => {
  assert.equal(assertShiftReportAccess(buildShift({ status: "CLOSED" }), KASIR).status, "CLOSED");
  assert.throws(
    () => assertShiftReportAccess(buildShift({ status: "OPEN" }), KASIR),
    (error) => error.status === 403,
  );
  assert.equal(assertShiftReportAccess(buildShift({ status: "OPEN" }), ADMIN).status, "OPEN");
});
