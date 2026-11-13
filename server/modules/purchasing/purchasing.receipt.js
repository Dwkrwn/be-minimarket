// =============================================================================
// PURCHASING - VALIDASI PENERIMAAN BARANG (GOODS RECEIPT)
// Logika murni (tanpa akses DB) agar aturan 3.1 dapat diuji dan dipakai ulang.
// =============================================================================

import { fail } from "../../../src/core/utils/helpers.js";

const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;

function toNumberOrNaN(value) {
  if (value === undefined || value === null || value === "") return NaN;
  return Number(value);
}

/**
 * Menormalkan dan memvalidasi baris penerimaan barang.
 *
 * Aturan (P1 #5):
 *  - barang wajib terdaftar pada PO (tidak ada fallback harga master lagi)
 *  - qty wajib bilangan bulat, tidak boleh negatif, tidak boleh 0 semua
 *  - total penerimaan bagus kumulatif tidak boleh melebihi qty PO
 *  - satu barang tidak boleh muncul dua kali dalam satu dokumen GR
 *
 * @param {object} args
 * @param {object} args.po            PO dengan `details` (item_id, qty_order_pcs, harga_satuan)
 * @param {Array}  args.items         Baris input dari request
 * @param {object} args.masterItems   Map item_id -> m_item (termasuk uom)
 * @param {object} args.uoms          Map uom_id -> m_uom
 * @param {Map}    args.receivedQtyByItem  Qty bagus yang sudah pernah diterima per item
 * @returns {Array} baris siap disimpan ke t_goods_receipt_d
 */
export function buildReceiptLines({
  po,
  items,
  masterItems = {},
  uoms = {},
  receivedQtyByItem = new Map(),
}) {
  if (!Array.isArray(items) || items.length === 0) {
    fail(400, "Rincian barang yang diterima tidak boleh kosong");
  }

  const poDetailsByItem = new Map((po.details || []).map((detail) => [detail.item_id, detail]));
  const seenItems = new Set();
  const lines = [];

  for (const raw of items) {
    const item_id = raw?.item_id;
    if (!item_id) fail(400, "Setiap baris penerimaan wajib menyertakan item_id");

    if (seenItems.has(item_id)) {
      fail(400, `Barang yang sama tidak boleh muncul lebih dari sekali dalam satu penerimaan (${item_id})`);
    }
    seenItems.add(item_id);

    const poDetail = poDetailsByItem.get(item_id);
    const masterItem = masterItems[item_id];
    const namaBarang = masterItem?.nama_barang || item_id;

    if (!poDetail) {
      fail(400, `Barang ${namaBarang} tidak terdaftar pada PO ${po.no_po}, penerimaan ditolak`);
    }
    if (!masterItem) fail(404, `Barang ${item_id} tidak ditemukan`);

    const qtyTerimaBeli = raw.qty_diterima_beli === undefined
      ? 0
      : toNumberOrNaN(raw.qty_diterima_beli);
    const qtyDitolak = raw.qty_ditolak_pcs === undefined
      ? 0
      : toNumberOrNaN(raw.qty_ditolak_pcs);
    const inputBagus = raw.qty_bagus_pcs === undefined
      ? undefined
      : toNumberOrNaN(raw.qty_bagus_pcs);

    if (!isNonNegativeInteger(qtyTerimaBeli)) {
      fail(400, `Qty diterima (satuan beli) untuk ${namaBarang} harus bilangan bulat >= 0`);
    }
    if (!isNonNegativeInteger(qtyDitolak)) {
      fail(400, `Qty ditolak untuk ${namaBarang} harus bilangan bulat >= 0`);
    }
    if (inputBagus !== undefined && !isNonNegativeInteger(inputBagus)) {
      fail(400, `Qty bagus (Pcs) untuk ${namaBarang} harus bilangan bulat >= 0`);
    }

    let conversionRatio = 1;
    if (raw.uom_id) {
      const uom = uoms[raw.uom_id];
      if (!uom) fail(400, `Satuan (UOM) ${raw.uom_id} tidak ditemukan`);
      conversionRatio = uom.rasio_konversi;
    } else if (masterItem.uom) {
      conversionRatio = masterItem.uom.rasio_konversi;
    }

    const qtyBagusPcs = inputBagus !== undefined ? inputBagus : qtyTerimaBeli * conversionRatio;
    if (!isNonNegativeInteger(qtyBagusPcs)) {
      fail(400, `Qty bagus (Pcs) untuk ${namaBarang} tidak valid setelah konversi satuan`);
    }
    if (qtyBagusPcs === 0 && qtyDitolak === 0) {
      fail(400, `Baris penerimaan ${namaBarang} tidak berisi qty bagus maupun qty ditolak`);
    }

    const alreadyReceived = receivedQtyByItem.get(item_id) || 0;
    const orderedQty = Number(poDetail.qty_order_pcs) || 0;
    if (alreadyReceived + qtyBagusPcs > orderedQty) {
      fail(
        400,
        `Penerimaan ${namaBarang} melebihi jumlah PO. Dipesan: ${orderedQty} Pcs, ` +
          `Sudah diterima: ${alreadyReceived} Pcs, Diminta sekarang: ${qtyBagusPcs} Pcs`,
      );
    }

    const hargaSatuanPcs = Number(poDetail.harga_satuan) || 0;

    lines.push({
      item_id,
      uom_id: raw.uom_id || masterItem.uom_id || null,
      qty_diterima_beli: qtyTerimaBeli,
      qty_bagus_pcs: qtyBagusPcs,
      qty_ditolak_pcs: qtyDitolak,
      harga_satuan_pcs: hargaSatuanPcs,
      subtotal: qtyBagusPcs * hargaSatuanPcs,
    });
  }

  if (lines.every((line) => line.qty_bagus_pcs === 0)) {
    fail(400, "Tidak ada barang bagus yang diterima, penerimaan tidak dapat disimpan");
  }

  return lines;
}

/**
 * Mengevaluasi status PO setelah penerimaan: COMPLETED bila seluruh qty PO
 * sudah terpenuhi oleh akumulasi qty bagus dari semua GR, selain itu
 * PARTIAL_RECEIVED.
 */
export function evaluatePoFulfillment(po, allReceipts = []) {
  const detailsList = po.details || [];

  for (const poDetail of detailsList) {
    let totalReceived = 0;
    for (const receipt of allReceipts) {
      for (const detail of receipt.details || []) {
        if (detail.item_id === poDetail.item_id) {
          totalReceived += Number(detail.qty_bagus_pcs) || 0;
        }
      }
    }
    if (totalReceived < Number(poDetail.qty_order_pcs)) {
      return "PARTIAL_RECEIVED";
    }
  }

  return "COMPLETED";
}
