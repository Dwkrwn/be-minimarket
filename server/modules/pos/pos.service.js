import prisma from "../../../src/config/database.js";
import { fail, isManager } from "../../../src/core/utils/helpers.js";
import {
  computeRestockPlan,
  parseBooleanFlag,
  parseWindowDays,
} from "./pos.restock.js";
import {
  assertCheckoutShift,
  assertShiftAccess,
  assertShiftReportAccess,
  projectActiveShift,
} from "./pos.shift.js";
import {
  createAutoPurchaseRequestIfAbsent,
  syncAutoPrForItems,
} from "../purchasing/autoPr.helper.js";

export { createAutoPurchaseRequestIfAbsent };

// =============================================================================
// POINT OF SALE (POS) SERVICE - SISTEM INFORMASI MANAJEMEN MINIMARKET TERINTEGRASI
// =============================================================================

// -----------------------------------------------------------------------------
// 2.1 Buka Shift Kasir (t_cashier_shift)
// -----------------------------------------------------------------------------
export async function openCashierShift(payload, user_id) {
  const { modal_awal = 0, catatan } = payload;
  const modalAwalNum = Number(modal_awal);

  if (modalAwalNum < 0) fail(400, "Modal awal tidak boleh negatif");

  // Cek apakah ada shift kasir yang masih berstatus OPEN untuk user ini
  const activeShift = await prisma.t_cashier_shift.findFirst({
    where: {
      user_id,
      status: "OPEN",
    },
  });

  if (activeShift) {
    fail(
      400,
      `Anda masih memiliki shift aktif (${activeShift.no_shift}) yang belum ditutup. Silakan tutup shift terlebih dahulu.`,
    );
  }

  const no_shift = `SFT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  return await prisma.t_cashier_shift.create({
    data: {
      no_shift,
      user_id,
      modal_awal: modalAwalNum,
      status: "OPEN",
      catatan,
    },
    include: {
      user: { select: { id: true, name: true, username: true } },
    },
  });
}

export async function getActiveCashierShift(user_id, actor = null) {
  const actorUser = actor && typeof actor === "object" ? actor : null;
  const fullAccess = !actorUser || isManager(actorUser);

  const shift = await prisma.t_cashier_shift.findFirst({
    where: {
      user_id,
      status: "OPEN",
    },
    include: {
      // Blind closing (P2 #11): daftar order & akumulasi omzet hanya untuk manager.
      orders: fullAccess,
      user: { select: { id: true, name: true } },
    },
  });

  return projectActiveShift(shift, actorUser);
}

// -----------------------------------------------------------------------------
// 1.1 Transaksi Atomik: Mesin Kasir / Checkout (t_pos_order) [KRUSIAL 5]
// Menjalankan pemrosesan penjualan kasir secara atomik:
// 1. Validasi shift kasir aktif
// 2. Baca harga dan stok rak m_item & t_stock (lokasi RAK)
// 3. Simpan t_pos_order dan t_pos_order_d
// 4. Potong saldo rak t_stock secara real-time
// 5. Tulis kartu stok t_stock_card (POS_PENJUALAN)
// 6. Akumulasikan omzet ke shift kasir t_cashier_shift
// -----------------------------------------------------------------------------
export async function executePosCheckoutTransaction(payload, actor, client = prisma) {
  const { shift_id, items, bayar, metode_bayar = "TUNAI", catatan } = payload;
  const actorUser = actor && typeof actor === "object" ? actor : null;
  const user_id = actorUser?.id ?? (typeof actor === "string" ? actor : null);

  if (!items || !Array.isArray(items) || items.length === 0) {
    fail(400, "Keranjang belanja tidak boleh kosong");
  }

  const posOrder = await client.$transaction(async (tx) => {
    // 1. Validasi shift kasir + kepemilikan shift (P2 #10)
    let shift = null;
    if (shift_id) {
      shift = await tx.t_cashier_shift.findUnique({ where: { id: shift_id } });
    } else {
      shift = await tx.t_cashier_shift.findFirst({
        where: { user_id, status: "OPEN" },
      });
    }

    if (actorUser) {
      assertCheckoutShift(shift, actorUser);
    } else if (!shift || shift.status !== "OPEN") {
      fail(400, "Kasir belum membuka shift atau shift sudah ditutup. Buka shift kasir terlebih dahulu.");
    }

    let calculatedTotal = 0;
    const orderDetailsData = [];
    const stockUpdates = [];

    // 2. Validasi stok rak & kalkulasi harga per item
    for (const itemCart of items) {
      const { item_id, qty_pcs, diskon = 0 } = itemCart;
      const qty = Number(qty_pcs);
      if (!qty || qty <= 0) fail(400, "Kuantitas belanja harus lebih dari 0");

      const item = await tx.m_item.findUnique({
        where: { id: item_id },
        include: { uom: true },
      });
      if (!item) fail(404, `Barang ${item_id} tidak ditemukan`);

      // Cek stok rak
      const rakStock = await tx.t_stock.findUnique({
        where: { item_id_location: { item_id, location: "RAK" } },
      });

      const currentRakQty = rakStock ? rakStock.qty : 0;
      if (currentRakQty < qty) {
        fail(
          400,
          `Stok di rak pajangan tidak mencukupi untuk '${item.nama_barang}'. Tersedia di rak: ${currentRakQty} Pcs, Diminta: ${qty} Pcs`,
        );
      }

      const harga_satuan = Number(item.harga_jual);
      const subtotal = qty * harga_satuan - Number(diskon);
      calculatedTotal += Math.max(0, subtotal);

      orderDetailsData.push({
        item_id,
        qty_pcs: qty,
        harga_satuan,
        diskon: Number(diskon),
        subtotal: Math.max(0, subtotal),
      });

      stockUpdates.push({
        item_id,
        nama_barang: item.nama_barang,
        qty_pcs: qty,
      });
    }

    const bayarNominal = Number(bayar);
    if (bayarNominal < calculatedTotal) {
      fail(400, `Uang pembayaran (${bayarNominal}) kurang dari total belanja (${calculatedTotal})`);
    }

    const kembalian = bayarNominal - calculatedTotal;
    const no_struk = `STR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // 3. Simpan transaksi ke t_pos_order dan rincian ke t_pos_order_d
    const posOrder = await tx.t_pos_order.create({
      data: {
        no_struk,
        shift_id: shift.id,
        user_id,
        total_amount: calculatedTotal,
        bayar: bayarNominal,
        kembalian,
        metode_bayar: metode_bayar.toUpperCase(),
        status: "COMPLETED",
        catatan,
        details: {
          create: orderDetailsData,
        },
      },
      include: {
        details: { include: { item: true } },
      },
    });

    // 4 & 5. Potong saldo rak t_stock dan catat t_stock_card
    for (const update of stockUpdates) {
      const updatedRakStock = await tx.t_stock.update({
        where: { item_id_location: { item_id: update.item_id, location: "RAK" } },
        data: { qty: { decrement: update.qty_pcs } },
      });

      await tx.t_stock_card.create({
        data: {
          item_id: update.item_id,
          no_dokumen: no_struk,
          jenis_mutasi: "POS_PENJUALAN",
          qty_in: 0,
          qty_out: update.qty_pcs,
          saldo_akhir: updatedRakStock.qty,
          location: "RAK",
          user_id,
          keterangan: `Penjualan Kasir (Struk: ${no_struk})`,
        },
      });
    }

    // 6. Akumulasikan omzet ke shift kasir
    if (metode_bayar.toUpperCase() === "TUNAI") {
      await tx.t_cashier_shift.update({
        where: { id: shift.id },
        data: { total_tunai: { increment: calculatedTotal } },
      });
    } else {
      await tx.t_cashier_shift.update({
        where: { id: shift.id },
        data: { total_non_tunai: { increment: calculatedTotal } },
      });
    }

    return posOrder;
  });

  await syncAutoPrForItems(
    client,
    (posOrder?.details || []).map((detail) => detail.item_id),
  );

  return posOrder;
}

// -----------------------------------------------------------------------------
// 2.2 Tutup Shift & Rekonsiliasi Kas (t_cashier_shift)
// -----------------------------------------------------------------------------
export async function closeCashierShift(shift_id, payload, actor, client = prisma) {
  const { uang_fisik_laci, catatan } = payload;
  const fisikLaci = Number(uang_fisik_laci);
  const actorUser = actor && typeof actor === "object" ? actor : null;

  if (fisikLaci < 0) fail(400, "Uang fisik laci tidak boleh negatif");

  return await client.$transaction(async (tx) => {
    const shift = await tx.t_cashier_shift.findUnique({
      where: { id: shift_id },
      include: { orders: true },
    });

    if (!shift) fail(404, "Shift kasir tidak ditemukan");
    // P2 #10: kasir hanya boleh menutup shift miliknya sendiri.
    if (actorUser) assertShiftAccess(shift, actorUser, { action: "menutup" });
    if (shift.status === "CLOSED") fail(400, "Shift kasir ini sudah ditutup sebelumnya");

    // Hitung ekspektasi uang kas di laci: modal awal + total penjualan tunai
    const modalAwal = Number(shift.modal_awal);
    const totalTunai = Number(shift.total_tunai);
    const ekspektasiKasLaci = modalAwal + totalTunai;

    // Hitung selisih kas fisik vs sistem
    const selisih = fisikLaci - ekspektasiKasLaci;

    const closedShift = await tx.t_cashier_shift.update({
      where: { id: shift_id },
      data: {
        uang_fisik_laci: fisikLaci,
        modal_akhir: fisikLaci,
        selisih,
        status: "CLOSED",
        closed_at: new Date(),
        catatan: catatan ? `${shift.catatan || ""}; ${catatan}` : shift.catatan,
      },
      include: {
        user: { select: { id: true, name: true, username: true } },
      },
    });

    return {
      ...closedShift,
      ekspektasi_kas_laci: ekspektasiKasLaci,
      status_rekonsiliasi: selisih === 0 ? "SEIMBANG" : selisih > 0 ? "LEBIH_KAS" : "KURANG_KAS",
    };
  });
}

// -----------------------------------------------------------------------------
// 3.1 Laporan Penjualan Shift Terkini (/pos/reports/current-shift)
// -----------------------------------------------------------------------------
export async function getShiftReport(shift_id, actor, client = prisma) {
  const actorUser = actor && typeof actor === "object" ? actor : null;

  const shift = await client.t_cashier_shift.findUnique({
    where: { id: shift_id },
    include: {
      user: { select: { id: true, name: true, username: true } },
      orders: {
        include: {
          details: { include: { item: true } },
        },
      },
    },
  });

  if (!shift) fail(404, "Shift kasir tidak ditemukan");
  // P2 #10: laporan shift hanya untuk pemilik shift atau Admin.
  // P2 #11: kasir hanya boleh melihat laporan setelah shift ditutup (blind closing).
  if (actorUser) assertShiftReportAccess(shift, actorUser);

  const byPaymentMethod = {
    TUNAI: 0,
    QRIS: 0,
    EDC: 0,
    TRANSFER: 0,
  };

  let totalOmzet = 0;
  for (const order of shift.orders) {
    if (order.status === "COMPLETED") {
      const amt = Number(order.total_amount);
      totalOmzet += amt;
      const method = order.metode_bayar.toUpperCase();
      byPaymentMethod[method] = (byPaymentMethod[method] || 0) + amt;
    }
  }

  const modalAwal = Number(shift.modal_awal);
  const totalTunai = byPaymentMethod.TUNAI;
  const ekspektasiKasLaci = modalAwal + totalTunai;
  const fisikLaci = shift.uang_fisik_laci !== null ? Number(shift.uang_fisik_laci) : null;
  const selisih = shift.selisih !== null ? Number(shift.selisih) : null;

  return {
    shift_id: shift.id,
    no_shift: shift.no_shift,
    kasir: shift.user.name,
    status: shift.status,
    opened_at: shift.opened_at,
    closed_at: shift.closed_at,
    total_transaksi: shift.orders.length,
    modal_awal: modalAwal,
    total_omzet: totalOmzet,
    omzet_per_metode: byPaymentMethod,
    rekonsiliasi_kas: {
      modal_awal: modalAwal,
      penjualan_tunai: totalTunai,
      ekspektasi_kas_laci: ekspektasiKasLaci,
      uang_fisik_laci: fisikLaci,
      selisih_kas: selisih,
    },
  };
}

// -----------------------------------------------------------------------------
// 3.2 Rekap Penjualan Harian Toko & Pemicu ROP ke Auto-PR [KRUSIAL 6]
// Menghubungkan Simpul 4:
// POS 3.2 -> Inventory 4.1 (m_item_rop) -> Purchasing 2.1 (t_purchase_req)
// -----------------------------------------------------------------------------

export async function getDailySalesAndTriggerRop(query = {}) {
  const windowDays = parseWindowDays(query.days_window);
  const triggerAutoPr = parseBooleanFlag(query.trigger_auto_pr, true);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - windowDays);
  startDate.setHours(0, 0, 0, 0);

  // 1. Ambil transaksi penjualan POS dalam rentang waktu window
  const orders = await prisma.t_pos_order.findMany({
    where: {
      status: "COMPLETED",
      createdAt: { gte: startDate },
    },
    include: {
      details: true,
    },
  });

  // Agregasi penjualan per barang
  const itemSalesMap = new Map();
  let totalOmzetHarian = 0;

  for (const order of orders) {
    totalOmzetHarian += Number(order.total_amount);
    for (const d of order.details) {
      const current = itemSalesMap.get(d.item_id) || { total_qty: 0, total_amount: 0 };
      current.total_qty += d.qty_pcs;
      current.total_amount += Number(d.subtotal);
      itemSalesMap.set(d.item_id, current);
    }
  }

  // 2. Evaluasi ROP dan Pemicu Auto-PR untuk seluruh item
  const allItems = await prisma.m_item.findMany({
    include: {
      rop_setting: true,
      stocks: true,
      uom: true,
      supplier_catalogs: {
        include: { supplier: true },
        orderBy: { harga_modal: "asc" }, // supplier termurah
      },
    },
  });

  const evaluationResults = [];
  const generatedAutoPrs = [];

  for (const item of allItems) {
    const salesData = itemSalesMap.get(item.id) || { total_qty: 0, total_amount: 0 };
    const plan = computeRestockPlan({
      item,
      totalSoldPcs: salesData.total_qty,
      windowDays,
    });

    // Update parameter di m_item_rop
    await prisma.m_item_rop.upsert({
      where: { item_id: item.id },
      update: {
        avg_daily_sales: plan.avgDailySales,
        rop_pcs: plan.ropPcs,
        last_calculated_at: new Date(),
      },
      create: {
        item_id: item.id,
        lead_time_days: plan.leadTime,
        safety_stock_pcs: plan.safetyStock,
        max_stock_pcs: plan.maxStock,
        avg_daily_sales: plan.avgDailySales,
        rop_pcs: plan.ropPcs,
        is_auto_pr: true,
        last_calculated_at: new Date(),
      },
    });

    // 3. Pemicu Belanja Otomatis (Auto-PR) jika total stok <= ROP,
    //    hanya untuk barang yang mengaktifkan is_auto_pr.
    let autoPrCreated = null;
    if (plan.isBelowRop && triggerAutoPr && plan.autoPrEnabled) {
      autoPrCreated = await createAutoPurchaseRequestIfAbsent(prisma, {
        item,
        plan,
      });
      if (autoPrCreated) generatedAutoPrs.push(autoPrCreated);
    }

    evaluationResults.push({
      item_id: item.id,
      barcode: item.barcode,
      nama_barang: item.nama_barang,
      penjualan_periode_pcs: salesData.total_qty,
      kecepatan_jual_harian: plan.avgDailySales,
      total_stok_toko_pcs: plan.totalCurrentStock,
      batas_rop_pcs: plan.ropPcs,
      status_stok: plan.isBelowRop ? "PERLU_RESTOCK" : "AMAN",
      auto_pr: autoPrCreated,
    });
  }

  return {
    rekap_penjualan_toko: {
      periode_hari: windowDays,
      total_omzet: totalOmzetHarian,
      total_transaksi: orders.length,
    },
    evaluasi_stok_rop: evaluationResults,
    antrean_auto_pr_baru: generatedAutoPrs,
  };
}

