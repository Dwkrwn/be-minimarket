import prisma from "../../config/database.js";
import { fail } from "../../core/utils/helpers.js";
import { createCrudService } from "../../core/crud.js";
import {
  categorySchema,
  unitSchema,
  rackSchema,
  itemSchema,
} from "./master.validation.js";

export const categoryService = createCrudService({
  model: prisma.m_category,
  label: "Kategori",
  searchFields: ["code", "name"],
  filterFields: ["is_active", "code"],
  allowedOrder: ["name", "code", "createdAt", "updatedAt", "is_active"],
  schema: categorySchema,
  include: { _count: { select: { items: true } } },
});

export const unitService = createCrudService({
  model: prisma.m_unit,
  label: "Satuan",
  searchFields: ["code", "name"],
  filterFields: ["is_active", "code"],
  allowedOrder: ["name", "code", "createdAt", "updatedAt", "is_active"],
  schema: unitSchema,
});

export const rackService = createCrudService({
  model: prisma.m_rack,
  label: "Rak",
  searchFields: ["code", "name", "location"],
  filterFields: ["is_active", "code", "location"],
  allowedOrder: ["name", "code", "location", "createdAt", "updatedAt"],
  schema: rackSchema,
  include: { _count: { select: { item_racks: true } } },
});

const itemInclude = {
  category: true,
  units: true,
  item_racks: { include: { rack: true } },
};

/**
 * Stok selalu disimpan di satuan terkecil (base unit).
 * Baris base unit dibuat otomatis bila payload tidak menyertakannya.
 */
function prepareUnits(baseUnit, units = []) {
  const list = units.map((unit) => ({ ...unit }));
  let base = list.find(
    (unit) => unit.unit_name.toLowerCase() === baseUnit.toLowerCase(),
  );

  if (!base) {
    base = {
      unit_name: baseUnit,
      conversion: 1,
      is_base: true,
      is_sell_unit: true,
    };
    list.unshift(base);
  } else {
    base.conversion = 1;
    base.is_base = true;
    base.is_sell_unit = true;
  }

  for (const unit of list) {
    if (unit !== base) unit.is_base = false;
    if (unit.conversion < 1) fail(400, "Konversi satuan minimal 1");
  }

  return list;
}

function prepareRacks(racks = []) {
  if (racks.filter((rack) => rack.is_default).length > 1) {
    fail(400, "Hanya boleh ada satu rak default");
  }
  return racks;
}

function splitItemPayload(value) {
  const { units, racks, ...item } = value;
  return {
    item,
    units: prepareUnits(item.base_unit, units),
    racks: prepareRacks(racks),
  };
}

export const itemService = createCrudService({
  model: prisma.m_item,
  label: "Barang",
  searchFields: ["barcode", "nama_barang", "base_unit"],
  filterFields: ["category_id", "is_active", "barcode", "base_unit"],
  allowedOrder: [
    "nama_barang",
    "barcode",
    "harga_jual",
    "harga_modal",
    "min_stock",
    "max_stock",
    "createdAt",
    "updatedAt",
    "is_active",
  ],
  include: itemInclude,
  schema: itemSchema,
  beforeCreate(value) {
    const { item, units, racks } = splitItemPayload(value);
    return {
      ...item,
      units: { create: units },
      item_racks: { create: racks },
    };
  },
  beforeUpdate(value) {
    const { item, units, racks } = splitItemPayload(value);
    return {
      ...item,
      units: { deleteMany: {}, create: units },
      item_racks: { deleteMany: {}, create: racks },
    };
  },
});

export async function getItemByBarcodeService(barcode) {
  const item = await prisma.m_item.findUnique({
    where: { barcode },
    include: itemInclude,
  });
  if (!item) fail(404, "Barang tidak ditemukan");
  return item;
}

export async function getItemStockService(itemId) {
  const item = await prisma.m_item.findUnique({ where: { id: itemId } });
  if (!item) fail(404, "Barang tidak ditemukan");

  const stocks = await prisma.t_stock.groupBy({
    by: ["location"],
    where: { item_id: itemId },
    _sum: { qty: true },
  });

  return {
    item_id: itemId,
    barcode: item.barcode,
    nama_barang: item.nama_barang,
    base_unit: item.base_unit,
    locations: Object.fromEntries(
      stocks.map((row) => [row.location, row._sum.qty || 0]),
    ),
    total: stocks.reduce((sum, row) => sum + (row._sum.qty || 0), 0),
  };
}
