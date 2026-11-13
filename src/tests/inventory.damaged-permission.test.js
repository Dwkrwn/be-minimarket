import test from "node:test";
import assert from "node:assert/strict";
import { assertDamagedReportAllowed } from "../../server/modules/inventory/inventory.damaged.js";

const KASIR = { id: "u-kasir", role: { system_key: "KASIR" } };
const GUDANG = { id: "u-gudang", role: { system_key: "GUDANG" } };
const ADMIN = { id: "u-admin", role: { system_key: "ADMIN" } };

test("Kasir tidak memiliki akses laporan barang rusak di lokasi mana pun", () => {
  for (const location of ["RAK", "GUDANG"]) {
    assert.throws(
      () => assertDamagedReportAllowed({ user: KASIR, location }),
      (error) => error.status === 403 && /tidak memiliki akses modul inventory/.test(error.message),
    );
  }
});

test("Kasir tidak boleh menautkan PO / menerbitkan nota retur", () => {
  assert.throws(
    () =>
      assertDamagedReportAllowed({
        user: KASIR,
        location: "RAK",
        po_id: "11111111-1111-4111-8111-111111111111",
      }),
    (error) => error.status === 403 && /tidak memiliki akses modul inventory/.test(error.message),
  );
});

test("Gudang dan Admin bebas melaporkan di lokasi mana pun dan menautkan PO", () => {
  for (const user of [GUDANG, ADMIN]) {
    assert.doesNotThrow(() =>
      assertDamagedReportAllowed({
        user,
        location: "GUDANG",
        kategori: "SUPPLIER_RETURN",
        po_id: "11111111-1111-4111-8111-111111111111",
      }),
    );
  }
});

test("pemanggilan internal tanpa objek user tidak dibatasi", () => {
  assert.doesNotThrow(() => assertDamagedReportAllowed({ location: "GUDANG" }));
  assert.doesNotThrow(() => assertDamagedReportAllowed({ user: null, location: "GUDANG" }));
});
