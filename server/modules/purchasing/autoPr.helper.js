import { computeRestockPlan } from "../pos/pos.restock.js";

const DEFAULT_WINDOW_DAYS = 7;
const AUTO_PR_TRIGGER = "AUTO_ROP";
export const ACTIVE_PO_STATUSES = ["ORDERED", "PARTIAL_RECEIVED"];

const ITEM_AUTO_PR_INCLUDE = {
  rop_setting: true,
  stocks: true,
  uom: true,
  supplier_catalogs: {
    where: { is_active: true, supplier: { is_active: true } },
    include: { supplier: true },
    orderBy: { harga_modal: "asc" },
  },
};

function canSyncAutoPr(client) {
  return (
    typeof client?.$transaction === "function" &&
    typeof client?.m_item?.findUnique === "function" &&
    typeof client?.m_item?.findMany === "function" &&
    typeof client?.t_purchase_req?.findFirst === "function" &&
    typeof client?.t_purchase_req?.findMany === "function" &&
    typeof client?.t_purchase_req?.updateMany === "function" &&
    typeof client?.t_purchase_order?.findFirst === "function" &&
    typeof client?.t_purchase_order_d?.findMany === "function"
  );
}

/**
 * Membatalkan Auto-PR yang masih menggantung untuk satu barang.
 * Dipakai saat barang nonaktif, belum terdaftar di ROP, atau stoknya sudah aman.
 */
async function cancelPendingAutoPr(client, itemId) {
  await client.t_purchase_req.updateMany({
    where: { item_id: itemId, status: "PENDING", triggered_by: AUTO_PR_TRIGGER },
    data: { status: "CANCELLED" },
  });
}

/**
 * Membuat Auto-PR secara atomik (P1 #7).
 *
 * Kunci advisory per barang membuat pemeriksaan "sudah ada PR/PO?" dan
 * pembuatan PR terjadi sekali saja walau dua request datang bersamaan.
 */
export async function createAutoPurchaseRequestIfAbsent(client, { item, plan }) {
  return await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auto-pr:${item.id}`})::bigint)`;

    const [existingPr, activePo] = await Promise.all([
      tx.t_purchase_req.findFirst({
        where: { item_id: item.id, status: "PENDING" },
      }),
      tx.t_purchase_order.findFirst({
        where: {
          status: { in: ACTIVE_PO_STATUSES },
          details: { some: { item_id: item.id } },
        },
      }),
    ]);

    // Barang yang sudah punya PO aktif tidak dibuatkan PR baru; barisnya tetap
    // ditampilkan di halaman rekomendasi sebagai "Sudah ada PO".
    if (existingPr || activePo) return null;

    const cheapestCatalog = item.supplier_catalogs?.[0] || null;
    const no_pr = `PR-AUTO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    return await tx.t_purchase_req.create({
      data: {
        no_pr,
        item_id: item.id,
        supplier_id: cheapestCatalog?.supplier_id || null,
        qty_saran_pcs: plan.qtySaranPcs,
        qty_saran_beli: plan.qtySaranBeli,
        stok_saat_ini: plan.totalCurrentStock,
        rop_threshold: plan.ropPcs,
        status: "PENDING",
        triggered_by: AUTO_PR_TRIGGER,
        catatan: `Pemicu otomatis: Stok (${plan.totalCurrentStock} Pcs) menyentuh batas ROP (${plan.ropPcs} Pcs)`,
      },
    });
  });
}

/**
 * Menghitung rencana belanja memakai ROP tersimpan (m_item_rop.rop_pcs) agar
 * status yang tampil sama persis dengan halaman Batasan Pemesanan Barang (ROP).
 */
export function buildPlanForStoredItem(item) {
  const savedAvgDailySales = Number(item.rop_setting?.avg_daily_sales || 0);
  const storedRop = item.rop_setting?.rop_pcs;

  return computeRestockPlan({
    item,
    totalSoldPcs: savedAvgDailySales * DEFAULT_WINDOW_DAYS,
    windowDays: DEFAULT_WINDOW_DAYS,
    ropOverride: storedRop === null || storedRop === undefined ? null : Number(storedRop),
  });
}

async function refreshPendingAutoPr(client, item, plan) {
  const cheapestCatalog = item.supplier_catalogs?.[0] || null;
  await client.t_purchase_req.updateMany({
    where: { item_id: item.id, status: "PENDING", triggered_by: AUTO_PR_TRIGGER },
    data: {
      supplier_id: cheapestCatalog?.supplier_id || null,
      qty_saran_pcs: plan.qtySaranPcs,
      qty_saran_beli: plan.qtySaranBeli,
      stok_saat_ini: plan.totalCurrentStock,
      rop_threshold: plan.ropPcs,
      catatan: `Pemicu otomatis: Stok (${plan.totalCurrentStock} Pcs) menyentuh batas ROP (${plan.ropPcs} Pcs)`,
    },
  });
}

/**
 * Menyinkronkan Auto-PR untuk satu barang setelah stok, master barang, atau ROP berubah.
 */
export async function syncAutoPrForItem(client, itemId) {
  if (!itemId || !canSyncAutoPr(client)) return null;

  const item = await client.m_item.findUnique({
    where: { id: itemId },
    include: ITEM_AUTO_PR_INCLUDE,
  });

  // Barang nonaktif atau belum terdaftar di Batasan Pemesanan Barang (ROP)
  // tidak boleh punya rekomendasi belanja.
  if (!item || !item.is_active || !item.rop_setting) {
    await cancelPendingAutoPr(client, itemId);
    return null;
  }

  const plan = buildPlanForStoredItem(item);
  if (!plan.autoPrEnabled || !plan.needsRestock) {
    await cancelPendingAutoPr(client, item.id);
    return null;
  }

  const activePo = await client.t_purchase_order.findFirst({
    where: {
      status: { in: ACTIVE_PO_STATUSES },
      details: { some: { item_id: item.id } },
    },
    select: { id: true },
  });
  if (activePo) {
    await client.t_purchase_req.updateMany({
      where: { item_id: item.id, status: "PENDING", triggered_by: AUTO_PR_TRIGGER },
      data: { status: "PO_CREATED" },
    });
    return null;
  }

  const created = await createAutoPurchaseRequestIfAbsent(client, { item, plan });
  if (!created) {
    await refreshPendingAutoPr(client, item, plan);
  }
  return created;
}

export async function syncAutoPrForItems(client, itemIds = []) {
  if (!canSyncAutoPr(client)) return [];
  const uniqueIds = [...new Set((itemIds || []).filter(Boolean))];
  const created = [];
  for (const itemId of uniqueIds) {
    const pr = await syncAutoPrForItem(client, itemId);
    if (pr) created.push(pr);
  }
  return created;
}

/**
 * Mengevaluasi seluruh barang yang terdaftar di Batasan Pemesanan Barang (ROP)
 * dan memastikan antrean Auto-PR PENDING selalu sinkron dengan posisi stok,
 * batas ROP tersimpan, dan status PO terkini.
 *
 * Barang berstatus selain "Aman" (Perlu Restock / Mendekati ROP) akan diusulkan.
 * Barang yang sudah punya PO aktif dikembalikan sebagai `waiting` supaya tetap
 * terlihat di halaman rekomendasi tanpa membuat PR baru.
 */
export async function syncAllBelowRopAutoPrs(client) {
  if (!canSyncAutoPr(client)) return { created: [], waiting: [] };

  const [items, pendingPrs, activePoDetails] = await Promise.all([
    client.m_item.findMany({
      where: { is_active: true, rop_setting: { isNot: null } },
      include: ITEM_AUTO_PR_INCLUDE,
    }),
    client.t_purchase_req.findMany({
      where: { status: "PENDING", triggered_by: AUTO_PR_TRIGGER },
      select: { item_id: true },
    }),
    client.t_purchase_order_d.findMany({
      where: { po: { status: { in: ACTIVE_PO_STATUSES } } },
      select: {
        item_id: true,
        po: { select: { id: true, no_po: true, status: true, createdAt: true } },
      },
    }),
  ]);

  const activeItemIds = new Set(items.map((item) => item.id));
  const pendingItemIds = new Set(pendingPrs.map((pr) => pr.item_id));

  const activePoByItemId = new Map();
  for (const detail of activePoDetails) {
    if (!activePoByItemId.has(detail.item_id) && detail.po) {
      activePoByItemId.set(detail.item_id, detail.po);
    }
  }

  const toCancelItemIds = [];
  const toMarkPoCreatedItemIds = [];
  const created = [];
  const waiting = [];

  // PR yang barangnya nonaktif atau belum terdaftar di ROP harus dibatalkan.
  for (const pendingItemId of pendingItemIds) {
    if (!activeItemIds.has(pendingItemId)) {
      toCancelItemIds.push(pendingItemId);
    }
  }

  for (const item of items) {
    const plan = buildPlanForStoredItem(item);
    const hasPending = pendingItemIds.has(item.id);
    const activePo = activePoByItemId.get(item.id) || null;

    if (!plan.autoPrEnabled || !plan.needsRestock) {
      if (hasPending) toCancelItemIds.push(item.id);
      continue;
    }

    if (activePo) {
      if (hasPending) toMarkPoCreatedItemIds.push(item.id);
      waiting.push({ item, plan, activePo });
      continue;
    }

    if (hasPending) {
      await refreshPendingAutoPr(client, item, plan);
    } else {
      const pr = await createAutoPurchaseRequestIfAbsent(client, { item, plan });
      if (pr) created.push(pr);
    }
  }

  if (toCancelItemIds.length > 0) {
    await client.t_purchase_req.updateMany({
      where: {
        item_id: { in: toCancelItemIds },
        status: "PENDING",
        triggered_by: AUTO_PR_TRIGGER,
      },
      data: { status: "CANCELLED" },
    });
  }

  if (toMarkPoCreatedItemIds.length > 0) {
    await client.t_purchase_req.updateMany({
      where: {
        item_id: { in: toMarkPoCreatedItemIds },
        status: "PENDING",
        triggered_by: AUTO_PR_TRIGGER,
      },
      data: { status: "PO_CREATED" },
    });
  }

  return { created, waiting };
}
