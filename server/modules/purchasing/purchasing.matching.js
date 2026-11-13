// =============================================================================
// PURCHASING - SHARED 3-WAY MATCHING CALCULATOR (PO vs GR vs RETUR)
// Satu sumber perhitungan untuk preview (4.1) dan eksekusi invoice.
// =============================================================================

// Retur yang ikut dihitung: yang belum cocok maupun yang sudah tercocokkan ke invoice.
// Dengan begitu angka preview tetap stabil walau invoice sudah terbit.
export const MATCHING_RETURN_STATUSES = ["ISSUED", "MATCHED_INVOICE"];

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * Menghitung 3-way matching dari objek PO yang sudah di-include:
 * supplier, details(item), goods_receipts(details), purchase_returns(details).
 *
 * Fungsi murni (tanpa akses DB) supaya bisa diuji dan dipakai ulang.
 */
export function computeThreeWayMatching(po) {
  if (!po) {
    throw Object.assign(new Error("Purchase Order tidak ditemukan"), { status: 404 });
  }

  const receipts = po.goods_receipts || [];
  const returns = (po.purchase_returns || []).filter((retur) =>
    MATCHING_RETURN_STATUSES.includes(retur.status),
  );

  const poItemIds = new Set((po.details || []).map((detail) => detail.item_id));

  const unmatchedReceiptItemIds = new Set();
  for (const receipt of receipts) {
    for (const detail of receipt.details || []) {
      if (!poItemIds.has(detail.item_id)) unmatchedReceiptItemIds.add(detail.item_id);
    }
  }

  const unmatchedReturnItemIds = new Set();
  for (const retur of returns) {
    for (const detail of retur.details || []) {
      if (!poItemIds.has(detail.item_id)) unmatchedReturnItemIds.add(detail.item_id);
    }
  }

  const matchingLines = [];
  let totalOrderGross = 0;
  let totalReceivedGoodGross = 0;
  let totalReturnDeduction = 0;

  for (const poDetail of po.details || []) {
    const itemId = poDetail.item_id;
    const hargaSatuan = Number(poDetail.harga_satuan) || 0;

    const qtyOrderPcs = Number(poDetail.qty_order_pcs) || 0;
    const subtotalOrder = roundMoney(qtyOrderPcs * hargaSatuan);
    totalOrderGross += subtotalOrder;

    let qtyBagusPcs = 0;
    let qtyRejectPcs = 0;
    for (const receipt of receipts) {
      for (const detail of receipt.details || []) {
        if (detail.item_id === itemId) {
          qtyBagusPcs += Number(detail.qty_bagus_pcs) || 0;
          qtyRejectPcs += Number(detail.qty_ditolak_pcs) || 0;
        }
      }
    }
    const subtotalReceivedGood = roundMoney(qtyBagusPcs * hargaSatuan);
    totalReceivedGoodGross += subtotalReceivedGood;

    let qtyReturPcs = 0;
    for (const retur of returns) {
      for (const detail of retur.details || []) {
        if (detail.item_id === itemId) qtyReturPcs += Number(detail.qty_pcs) || 0;
      }
    }
    const subtotalRetur = roundMoney(qtyReturPcs * hargaSatuan);
    totalReturnDeduction += subtotalRetur;

    const qtyBersihPcs = Math.max(0, qtyBagusPcs - qtyReturPcs);
    const nominalBersih = roundMoney(qtyBersihPcs * hargaSatuan);

    matchingLines.push({
      item_id: itemId,
      nama_barang: poDetail.item?.nama_barang,
      barcode: poDetail.item?.barcode,
      harga_satuan: hargaSatuan,
      bukti_1_pesanan: {
        qty_pcs: qtyOrderPcs,
        subtotal: subtotalOrder,
      },
      bukti_2_terima_gudang: {
        qty_bagus_pcs: qtyBagusPcs,
        qty_reject_pcs: qtyRejectPcs,
        subtotal: subtotalReceivedGood,
      },
      bukti_3_retur_gudang: {
        qty_retur_pcs: qtyReturPcs,
        subtotal_potongan: subtotalRetur,
      },
      kalkulasi_bersih: {
        qty_bersih_pcs: qtyBersihPcs,
        nominal_bersih_bayar: nominalBersih,
      },
    });
  }

  totalOrderGross = roundMoney(totalOrderGross);
  totalReceivedGoodGross = roundMoney(totalReceivedGoodGross);
  totalReturnDeduction = roundMoney(totalReturnDeduction);
  const netPayableLocked = roundMoney(
    Math.max(0, totalReceivedGoodGross - totalReturnDeduction),
  );

  return {
    po_id: po.id,
    no_po: po.no_po,
    supplier: po.supplier
      ? {
          id: po.supplier.id,
          nama_supplier: po.supplier.nama_supplier,
          term_of_payment: po.supplier.term_of_payment,
        }
      : null,
    matching_lines: matchingLines,
    summary_verifikasi: {
      jumlah_goods_receipt: receipts.length,
      jumlah_retur: returns.length,
      total_pesanan_awal_po: totalOrderGross,
      total_bukti_masuk_bagus_gr: totalReceivedGoodGross,
      total_potongan_nota_retur: totalReturnDeduction,
      total_bersih_dikunci: netPayableLocked,
    },
    gr_ids: receipts.map((receipt) => receipt.id),
    return_ids: returns.map((retur) => retur.id),
    return_ids_issued: returns
      .filter((retur) => retur.status === "ISSUED")
      .map((retur) => retur.id),
    has_receipts: receipts.length > 0,
    unmatched_receipt_item_ids: [...unmatchedReceiptItemIds],
    unmatched_return_item_ids: [...unmatchedReturnItemIds],
    keterangan_sistem: `Sistem mengunci Total Bersih yang Diizinkan untuk Dibayar: Rp${netPayableLocked.toLocaleString("id-ID")}`,
  };
}
