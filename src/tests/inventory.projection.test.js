import test from "node:test";
import assert from "node:assert/strict";
import {
  canViewCostPrices,
  projectItem,
  projectItems,
  projectRowsWithItem,
} from "../../server/modules/inventory/inventory.projection.js";

const KASIR = { id: "u-kasir", role: { system_key: "KASIR" } };
const GUDANG = { id: "u-gudang", role: { system_key: "GUDANG" } };
const ADMIN = { id: "u-admin", role: { system_key: "ADMIN" } };
const SUPER_ADMIN = { id: "u-super", role: { system_key: "SUPER_ADMIN" } };

function buildItem() {
  return {
    id: "item-1",
    nama_barang: "Beras 1kg",
    harga_modal: 9000,
    harga_jual: 12000,
    uom: { id: "uom-1", rasio_konversi: 12 },
    supplier_catalogs: [
      { id: "cat-1", harga_modal: 8500, supplier: { id: "sup-1" } },
    ],
  };
}

test("canViewCostPrices hanya untuk Admin/Super Admin (P2 #13)", () => {
  assert.equal(canViewCostPrices(ADMIN), true);
  assert.equal(canViewCostPrices(SUPER_ADMIN), true);
  assert.equal(canViewCostPrices(KASIR), false);
  assert.equal(canViewCostPrices(GUDANG), false);
  assert.equal(canViewCostPrices(null), true, "pemanggilan internal tetap penuh");
});

test("projectItem menyembunyikan harga modal dari Kasir dan Gudang", () => {
  for (const user of [KASIR, GUDANG]) {
    const projected = projectItem(buildItem(), user);

    assert.equal("harga_modal" in projected, false);
    assert.equal(projected.harga_jual, 12000);
    assert.equal(projected.nama_barang, "Beras 1kg");
    assert.equal("harga_modal" in projected.supplier_catalogs[0], false);
    assert.equal(projected.supplier_catalogs[0].harga_modal, undefined);
    assert.equal(projected.supplier_catalogs[0].supplier.id, "sup-1");
  }
});

test("projectItem mempertahankan harga modal untuk Admin", () => {
  const item = buildItem();
  const projected = projectItem(item, ADMIN);

  assert.equal(projected, item);
  assert.equal(projected.harga_modal, 9000);
  assert.equal(projected.supplier_catalogs[0].harga_modal, 8500);
});

test("projectItems memproyeksikan seluruh daftar barang", () => {
  const items = [buildItem(), { ...buildItem(), id: "item-2" }];
  const projected = projectItems(items, KASIR);

  assert.equal(projected.length, 2);
  for (const item of projected) {
    assert.equal("harga_modal" in item, false);
  }
});

test("projectRowsWithItem membersihkan item di dalam baris stok/kartu stok", () => {
  const rows = [
    { id: "stock-1", location: "RAK", qty: 10, item: buildItem() },
    { id: "stock-2", location: "GUDANG", qty: 5, item: buildItem() },
  ];

  const projected = projectRowsWithItem(rows, KASIR);
  assert.equal(projected.length, 2);
  assert.equal(projected[0].qty, 10);
  assert.equal("harga_modal" in projected[0].item, false);
  assert.equal("harga_modal" in projected[1].item, false);

  const adminRows = projectRowsWithItem(rows, ADMIN);
  assert.equal(adminRows, rows);
  assert.equal(adminRows[0].item.harga_modal, 9000);
});

test("projectRowsWithItem tidak mengubah baris yang tidak punya item", () => {
  const rows = [{ id: "x", total: 1 }];
  assert.deepEqual(projectRowsWithItem(rows, KASIR), rows);
});
