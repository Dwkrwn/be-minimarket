// =============================================================================
// INVENTORY - PROYEKSI DATA SENSITIF
// Harga modal (HPP) adalah data finansial. Kasir dan Gudang hanya boleh melihat
// harga jual; Admin/Super Admin tetap melihat harga modal penuh (P2 #13).
// =============================================================================

import { isManager } from "../../../src/core/utils/helpers.js";

/**
 * Pemanggilan internal tanpa objek user (job, test, legacy) tetap mendapat
 * data penuh agar tidak memutus alur non-HTTP.
 */
export function canViewCostPrices(user) {
  if (!user || typeof user !== "object") return true;
  return isManager(user);
}

function withoutCost(object) {
  if (!object || typeof object !== "object") return object;

  const { harga_modal, ...rest } = object;

  if (Array.isArray(rest.supplier_catalogs)) {
    rest.supplier_catalogs = rest.supplier_catalogs.map((catalog) => {
      if (!catalog || typeof catalog !== "object") return catalog;
      const { harga_modal: _omit, ...catalogRest } = catalog;
      return catalogRest;
    });
  }

  return rest;
}

export function projectItem(item, user) {
  if (canViewCostPrices(user)) return item;
  return withoutCost(item);
}

export function projectItems(items, user) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => projectItem(item, user));
}

/** Untuk baris yang membungkus item, mis. t_stock dan t_stock_card. */
export function projectRowsWithItem(rows, user) {
  if (!Array.isArray(rows)) return rows;
  if (canViewCostPrices(user)) return rows;

  return rows.map((row) => {
    if (!row || typeof row !== "object" || !row.item) return row;
    return { ...row, item: withoutCost(row.item) };
  });
}
