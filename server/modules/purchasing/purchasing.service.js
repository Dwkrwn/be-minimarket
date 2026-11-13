import prisma from "../../../src/config/database.js";
import { fail } from "../../../src/core/utils/helpers.js";
import { computeThreeWayMatching } from "./purchasing.matching.js";
import { buildReceiptLines, evaluatePoFulfillment } from "./purchasing.receipt.js";
import { assertReturnAllowed, issuePurchaseReturn } from "./purchasing.return.js";
import {
  syncAllBelowRopAutoPrs,
  syncAutoPrForItem,
  syncAutoPrForItems,
} from "./autoPr.helper.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Transaksi purchasing menyentuh banyak tabel (PO, GR, stok, kartu stok,
// invoice). Default Prisma 5 detik terlalu ketat ketika database cloud
// memiliki latensi tinggi, sehingga transaksi bisa gagal P2028.
const TRANSACTION_OPTIONS = { maxWait: 15000, timeout: 30000 };

// =============================================================================
// MODUL PURCHASING - SISTEM INFORMASI MANAJEMEN MINIMARKET TERINTEGRASI
// (Alur Revisi: Tanpa Sub-Modul 5.2, Terintegrasi Penuh Antar-Tahap 1 s.d. 5)
// =============================================================================

// -----------------------------------------------------------------------------
// TAHAP 1: PERSIAPAN DATA PEMASOK & HARGA MODAL (KELOMPOK 1)
// -----------------------------------------------------------------------------

// 1.1 Daftar Supplier (m_supplier)
export async function listSuppliers(query = {}) {
  const { search, is_active } = query;
  const where = {};
  if (is_active !== undefined) where.is_active = is_active === "true" || is_active === true;
  if (search) {
    where.OR = [
      { kode_supplier: { contains: search, mode: "insensitive" } },
      { nama_supplier: { contains: search, mode: "insensitive" } },
      { kontak_sales: { contains: search, mode: "insensitive" } },
      { no_wa: { contains: search, mode: "insensitive" } },
    ];
  }
  return await prisma.m_supplier.findMany({
    where,
    orderBy: { nama_supplier: "asc" },
  });
}

export async function createSupplier(data) {
  const {
    kode_supplier,
    nama_supplier,
    kontak_sales,
    no_telp,
    no_wa,
    alamat,
    term_of_payment = 0,
    catatan,
  } = data;

  if (!kode_supplier || !nama_supplier) {
    fail(400, "Kode supplier dan nama supplier wajib diisi");
  }

  return await prisma.m_supplier.create({
    data: {
      kode_supplier,
      nama_supplier,
      kontak_sales,
      no_telp,
      no_wa,
      alamat,
      term_of_payment: Number(term_of_payment),
      catatan,
    },
  });
}

export async function updateSupplier(id, data) {
  if (data.term_of_payment !== undefined) {
    data.term_of_payment = Number(data.term_of_payment);
  }
  return await prisma.m_supplier.update({
    where: { id },
    data,
  });
}

export async function getSupplierDetail(id, client = prisma) {
  const supplier = await client.m_supplier.findUnique({
    where: { id },
    include: {
      catalogs: {
        include: { item: { include: { uom: true } } },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: {
          purchase_orders: true,
          purchase_returns: true,
        },
      },
    },
  });
  if (!supplier) fail(404, "Supplier tidak ditemukan");
  return supplier;
}

export async function deleteSupplier(id) {
  return await prisma.m_supplier.delete({
    where: { id },
  });
}

// 1.2 Katalog Harga & Produk Supplier (m_supplier_catalog)
// Membandingkan harga beli (HPP) antar-distributor dan otomatis merekomendasikan supplier termurah
export async function listSupplierCatalogs(query = {}) {
  const { supplier_id, item_id, search } = query;
  const where = {};
  if (supplier_id) where.supplier_id = supplier_id;
  if (item_id) where.item_id = item_id;
  if (search) {
    where.item = {
      OR: [
        { barcode: { contains: search, mode: "insensitive" } },
        { nama_barang: { contains: search, mode: "insensitive" } },
      ],
    };
  }

  const catalogs = await prisma.m_supplier_catalog.findMany({
    where,
    include: {
      supplier: true,
      item: { include: { uom: true } },
    },
    orderBy: [{ item: { nama_barang: "asc" } }, { harga_modal: "asc" }],
  });

  // Cari harga termurah untuk tiap barang untuk memberikan label rekomendasi otomatis
  const minPricePerItem = new Map();
  for (const cat of catalogs) {
    const currentMin = minPricePerItem.get(cat.item_id);
    const price = Number(cat.harga_modal);
    if (currentMin === undefined || price < currentMin) {
      minPricePerItem.set(cat.item_id, price);
    }
  }

  return catalogs.map((cat) => ({
    ...cat,
    is_cheapest_recommendation: Number(cat.harga_modal) === minPricePerItem.get(cat.item_id),
  }));
}

export async function createOrUpdateSupplierCatalog(data) {
  const { supplier_id, item_id, harga_modal, is_active = true } = data;
  if (!harga_modal || Number(harga_modal) <= 0) {
    fail(400, "Harga modal (HPP) harus lebih dari 0");
  }

  const catalog = await prisma.m_supplier_catalog.upsert({
    where: {
      supplier_id_item_id: { supplier_id, item_id },
    },
    update: {
      harga_modal: Number(harga_modal),
      is_active,
    },
    create: {
      supplier_id,
      item_id,
      harga_modal: Number(harga_modal),
      is_active,
    },
    include: {
      supplier: true,
      item: { include: { uom: true } },
    },
  });

  await syncAutoPrForItem(prisma, item_id);
  return catalog;
}

export async function deleteSupplierCatalog(id) {
  return await prisma.m_supplier_catalog.delete({
    where: { id },
  });
}

// -----------------------------------------------------------------------------
// TAHAP 2: DETEKSI STOK TIPIS & PEMESANAN BARANG (KELOMPOK 2)
// -----------------------------------------------------------------------------

// 2.1 Rekomendasi Belanja Otomatis (Auto-PR, t_purchase_req)
export async function listPurchaseRequests(query = {}) {
  const { status = "PENDING" } = query;
  if (status === "PENDING") {
    await syncAllBelowRopAutoPrs(prisma);
  }
  const where = {};
  if (status) where.status = status;

  const prs = await prisma.t_purchase_req.findMany({
    where,
    include: {
      item: {
        include: {
          uom: true,
          stocks: true,
          rop_setting: true,
          supplier_catalogs: {
            where: { is_active: true, supplier: { is_active: true } },
            include: { supplier: true },
            orderBy: { harga_modal: "asc" },
          },
        },
      },
      supplier: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return prs.map((pr) => {
    const totalStok = pr.item.stocks.reduce((acc, s) => acc + s.qty, 0);
    const supplierTermurah = pr.item.supplier_catalogs[0]?.supplier || pr.supplier;
    const hargaModalTermurah = pr.item.supplier_catalogs[0]
      ? Number(pr.item.supplier_catalogs[0].harga_modal)
      : Number(pr.item.harga_modal);

    return {
      id: pr.id,
      no_pr: pr.no_pr,
      item_id: pr.item_id,
      nama_barang: pr.item.nama_barang,
      barcode: pr.item.barcode,
      satuan_beli: pr.item.uom?.satuan_beli || "Kardus",
      rasio_konversi: pr.item.uom?.rasio_konversi || 1,
      stok_saat_ini_pcs: totalStok,
      rop_threshold_pcs: pr.rop_threshold,
      qty_saran_pcs: pr.qty_saran_pcs,
      qty_saran_beli: pr.qty_saran_beli,
      supplier_rekomendasi: supplierTermurah
        ? {
            id: supplierTermurah.id,
            nama_supplier: supplierTermurah.nama_supplier,
            no_wa: supplierTermurah.no_wa,
            term_of_payment: supplierTermurah.term_of_payment,
            harga_modal_pcs: hargaModalTermurah,
          }
        : null,
      estimasi_biaya: pr.qty_saran_pcs * hargaModalTermurah,
      status: pr.status,
      peringatan_merah: totalStok <= pr.rop_threshold,
      createdAt: pr.createdAt,
    };
  });
}

// Konversi pilihan centang Auto-PR menjadi Purchase Order (PO) resmi
export async function convertAutoPrToPo(payload, user_id) {
  const { pr_ids, tgl_estimasi_tiba, catatan } = payload;
  if (!pr_ids || !Array.isArray(pr_ids) || pr_ids.length === 0) {
    fail(400, "Pilih minimal satu rekomendasi belanja (Auto-PR) untuk dibuatkan PO");
  }

  return await prisma.$transaction(async (tx) => {
    const prs = await tx.t_purchase_req.findMany({
      where: { id: { in: pr_ids }, status: "PENDING" },
      include: {
        item: {
          include: {
            uom: true,
            supplier_catalogs: {
              where: { is_active: true, supplier: { is_active: true } },
              include: { supplier: true },
              orderBy: { harga_modal: "asc" },
            },
          },
        },
      },
    });

    if (prs.length === 0) {
      fail(400, "Tidak ada data Auto-PR berstatus PENDING yang valid untuk diproses");
    }

    // Kelompokkan item berdasarkan supplier termurah agar masing-masing supplier mendapatkan PO terpisah
    const supplierGroups = new Map();

    for (const pr of prs) {
      const bestCatalog = pr.item.supplier_catalogs[0];
      const supplier_id = pr.supplier_id || bestCatalog?.supplier_id;
      if (!supplier_id) {
        fail(400, `Barang '${pr.item.nama_barang}' belum memiliki pemasok terdaftar di Katalog Harga`);
      }

      if (!supplierGroups.has(supplier_id)) {
        supplierGroups.set(supplier_id, []);
      }
      supplierGroups.get(supplier_id).push(pr);
    }

    const createdPOs = [];

    for (const [supplier_id, groupPrs] of supplierGroups.entries()) {
      const no_po = `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      let total_amount = 0;
      const poDetailsData = [];

      for (const pr of groupPrs) {
        const item = pr.item;
        const uom = item.uom;
        const conversion_ratio = uom ? uom.rasio_konversi : 1;
        const qty_order_beli = pr.qty_saran_beli;
        const qty_order_pcs = pr.qty_saran_pcs;

        let hargaModalPcs = Number(item.harga_modal);
        const catalog = item.supplier_catalogs.find((c) => c.supplier_id === supplier_id);
        if (catalog) hargaModalPcs = Number(catalog.harga_modal);

        const subtotal = qty_order_pcs * hargaModalPcs;
        total_amount += subtotal;

        poDetailsData.push({
          item_id: item.id,
          uom_id: uom?.id || null,
          qty_order_beli,
          conversion_ratio,
          qty_order_pcs,
          harga_satuan: hargaModalPcs,
          subtotal,
        });
      }

      const po = await tx.t_purchase_order.create({
        data: {
          no_po,
          supplier_id,
          status: "ORDERED", // 🟡 Menunggu Pengiriman Truk
          tgl_estimasi_tiba: tgl_estimasi_tiba ? new Date(tgl_estimasi_tiba) : null,
          total_amount,
          catatan: catatan || `Terbit otomatis dari Auto-PR (${groupPrs.map((p) => p.no_pr).join(", ")})`,
          user_id,
          details: { create: poDetailsData },
        },
        include: {
          supplier: true,
          details: { include: { item: true } },
        },
      });

      // Update status PR menjadi PO_CREATED
      await tx.t_purchase_req.updateMany({
        where: { id: { in: groupPrs.map((p) => p.id) } },
        data: { status: "PO_CREATED" },
      });

      createdPOs.push(po);
    }

    return createdPOs;
  }, TRANSACTION_OPTIONS);
}

// 2.2 Buat & Kelola Purchase Order (t_purchase_order)
export async function listPurchaseOrders(query = {}) {
  const { status, supplier_id, search } = query;
  const where = {};
  if (status) where.status = status;
  if (supplier_id) where.supplier_id = supplier_id;
  if (search) {
    where.OR = [
      { no_po: { contains: search, mode: "insensitive" } },
      { supplier: { nama_supplier: { contains: search, mode: "insensitive" } } },
    ];
  }

  const pos = await prisma.t_purchase_order.findMany({
    where,
    include: {
      supplier: true,
      details: { include: { item: { include: { uom: true } }, uom: true } },
      goods_receipts: true,
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return pos.map((po) => {
    let statusLabel = "🟡 Menunggu Pengiriman Truk";
    if (po.status === "COMPLETED") statusLabel = "🟢 Selesai";
    else if (po.status === "PARTIAL_RECEIVED") statusLabel = "🟠 Diterima Sebagian";
    else if (po.status === "CANCELLED") statusLabel = "🔴 Dibatalkan";

    return {
      ...po,
      status_label: statusLabel,
    };
  });
}

export async function getPurchaseOrderDetail(id) {
  const po = await prisma.t_purchase_order.findUnique({
    where: { id },
    include: {
      supplier: true,
      details: {
        include: {
          item: { include: { uom: true } },
          uom: true,
        },
      },
      goods_receipts: {
        include: {
          details: { include: { item: true } },
        },
      },
      purchase_returns: {
        include: { details: true },
      },
      invoices: true,
      user: { select: { id: true, name: true } },
    },
  });
  if (!po) fail(404, "Purchase Order tidak ditemukan");

  let statusLabel = "🟡 Menunggu Pengiriman Truk";
  if (po.status === "COMPLETED") statusLabel = "🟢 Selesai";
  else if (po.status === "PARTIAL_RECEIVED") statusLabel = "🟠 Diterima Sebagian";
  else if (po.status === "CANCELLED") statusLabel = "🔴 Dibatalkan";

  return {
    ...po,
    status_label: statusLabel,
  };
}

export async function createPurchaseOrder(payload, user_id) {
  const { supplier_id, pr_id, tgl_estimasi_tiba, catatan, items } = payload;
  if (!items || !Array.isArray(items) || items.length === 0) {
    fail(400, "Daftar barang pesanan PO tidak boleh kosong");
  }

  return await prisma.$transaction(async (tx) => {
    const no_po = `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    let total_amount = 0;
    const poDetailsData = [];

    for (const itemEntry of items) {
      const { item_id, qty_order_beli = 1, uom_id } = itemEntry;
      const item = await tx.m_item.findUnique({
        where: { id: item_id },
        include: { uom: true },
      });
      if (!item) fail(404, `Barang ${item_id} tidak ditemukan`);

      let uom = null;
      if (uom_id) {
        uom = await tx.m_uom.findUnique({ where: { id: uom_id } });
      } else if (item.uom_id) {
        uom = item.uom;
      }
      const conversion_ratio = uom ? uom.rasio_konversi : 1;
      const qty_order_pcs = Number(qty_order_beli) * conversion_ratio;

      let hargaModalPcs = Number(item.harga_modal);
      const catalog = await tx.m_supplier_catalog.findUnique({
        where: { supplier_id_item_id: { supplier_id, item_id } },
      });
      if (catalog) hargaModalPcs = Number(catalog.harga_modal);

      const subtotal = qty_order_pcs * hargaModalPcs;
      total_amount += subtotal;

      poDetailsData.push({
        item_id,
        uom_id: uom?.id || null,
        qty_order_beli: Number(qty_order_beli),
        conversion_ratio,
        qty_order_pcs,
        harga_satuan: hargaModalPcs,
        subtotal,
      });
    }

    const po = await tx.t_purchase_order.create({
      data: {
        no_po,
        supplier_id,
        pr_id: pr_id || null,
        status: "ORDERED", // 🟡 Menunggu Pengiriman Truk
        tgl_estimasi_tiba: tgl_estimasi_tiba ? new Date(tgl_estimasi_tiba) : null,
        total_amount,
        catatan,
        user_id,
        details: { create: poDetailsData },
      },
      include: {
        details: { include: { item: true } },
        supplier: true,
      },
    });

    if (pr_id) {
      await tx.t_purchase_req.update({
        where: { id: pr_id },
        data: { status: "PO_CREATED" },
      });
    }

    const orderedItemIds = [...new Set(poDetailsData.map((d) => d.item_id).filter(Boolean))];
    if (orderedItemIds.length > 0) {
      await tx.t_purchase_req.updateMany({
        where: {
          item_id: { in: orderedItemIds },
          status: "PENDING",
          triggered_by: "AUTO_ROP",
        },
        data: { status: "PO_CREATED" },
      });
    }

    return po;
  }, TRANSACTION_OPTIONS);
}

// Fitur 2.2: Kirim PDF / WA Sales / Email Distributor
export async function sendPurchaseOrderDocument(id, method = "WA") {
  const po = await prisma.t_purchase_order.findUnique({
    where: { id },
    include: {
      supplier: true,
      details: { include: { item: { include: { uom: true } } } },
    },
  });
  if (!po) fail(404, "Purchase Order tidak ditemukan");

  const supplier = po.supplier;
  const itemsText = po.details
    .map(
      (d, i) =>
        `${i + 1}. ${d.item.nama_barang} - ${d.qty_order_beli} ${d.item.uom?.satuan_beli || "Kardus"} (${d.qty_order_pcs} Pcs) @ Rp${Number(d.harga_satuan).toLocaleString("id-ID")}`,
    )
    .join("\n");

  const messageText = `Yth. ${supplier.nama_supplier} (Sales: ${supplier.kontak_sales || "-"})\n\nBerikut Surat Pesanan Resmi:\nNo PO: ${po.no_po}\nTanggal: ${new Date(po.tgl_po).toLocaleDateString("id-ID")}\n\nRincian Pesanan:\n${itemsText}\n\nTotal Estimasi: Rp${Number(po.total_amount).toLocaleString("id-ID")}\nSyarat Pembayaran: Tempo ${supplier.term_of_payment} Hari (TOP)\n\nMohon konfirmasi jadwal pengiriman truk. Terima kasih.`;

  return {
    po_id: po.id,
    no_po: po.no_po,
    supplier_name: supplier.nama_supplier,
    target_wa: supplier.no_wa || supplier.no_telp,
    target_email: null,
    delivery_channel: method,
    message_draft: messageText,
    pdf_download_url: `/api/v1/purchasing/purchase-orders/${po.id}/pdf`,
    status_pengiriman: "SIAP_DIKIRIM",
  };
}

// 2.3 Pantau Status Pesanan (Tracking PO)
export async function trackPurchaseOrder(id) {
  const po = await prisma.t_purchase_order.findUnique({
    where: { id },
    include: {
      supplier: true,
      details: { include: { item: { include: { uom: true } } } },
      goods_receipts: {
        include: { details: true },
      },
    },
  });
  if (!po) fail(404, "PO tidak ditemukan");

  const trackingItems = po.details.map((d) => {
    let received_pcs = 0;
    let rejected_pcs = 0;

    for (const gr of po.goods_receipts) {
      const grItem = gr.details.find((grid) => grid.item_id === d.item_id);
      if (grItem) {
        received_pcs += grItem.qty_bagus_pcs;
        rejected_pcs += grItem.qty_ditolak_pcs;
      }
    }

    const remaining_pcs = Math.max(0, d.qty_order_pcs - received_pcs);
    const fulfillment_rate =
      d.qty_order_pcs > 0 ? ((received_pcs / d.qty_order_pcs) * 100).toFixed(1) : 0;

    return {
      item_id: d.item_id,
      nama_barang: d.item.nama_barang,
      barcode: d.item.barcode,
      qty_order_pcs: d.qty_order_pcs,
      received_pcs,
      rejected_pcs,
      remaining_pcs,
      fulfillment_rate: `${fulfillment_rate}%`,
    };
  });

  let statusBadge = "🟡 Menunggu Pengiriman Truk";
  if (po.status === "COMPLETED") statusBadge = "🟢 Selesai";
  else if (po.status === "PARTIAL_RECEIVED") statusBadge = "🟠 Diterima Sebagian";

  return {
    po_id: po.id,
    no_po: po.no_po,
    supplier: po.supplier.nama_supplier,
    status_raw: po.status,
    status_badge: statusBadge,
    tgl_po: po.tgl_po,
    trackingItems,
  };
}

// -----------------------------------------------------------------------------
// TAHAP 3: PENERIMAAN FISIK DI GUDANG & RETUR BARANG RUSAK (KELOMPOK 3)
// -----------------------------------------------------------------------------

// 3.1 Input Barang Masuk (Goods Receipt, t_goods_receipt & t_goods_receipt_d)
// Saat disimpan:
// 1. Stok di Inventory (t_stock & t_stock_card) otomatis bertambah sebanyak kuantitas diterima bagus
// 2. Status PO di 2.3 berubah menjadi 🟢 Selesai (atau 🟠 Diterima Sebagian)
// 3. Angka penerimaan bagus langsung disalurkan ke 4.1 Verifikasi Nota
export async function executeGoodsReceiptTransaction(payload, user_id, client = prisma) {
  const { po_id, no_surat_jalan, catatan, items } = payload;
  if (!po_id) fail(400, "Purchase Order wajib dipilih untuk penerimaan barang");
  if (!UUID_PATTERN.test(String(po_id))) fail(400, "Purchase Order tidak valid");
  if (!items || !Array.isArray(items) || items.length === 0) {
    fail(400, "Rincian barang yang diterima tidak boleh kosong");
  }

  const result = await client.$transaction(async (tx) => {
    const po = await tx.t_purchase_order.findUnique({
      where: { id: po_id },
      include: { details: true, supplier: true },
    });
    if (!po) fail(404, "Purchase Order tidak ditemukan");
    if (["COMPLETED", "CANCELLED"].includes(po.status)) {
      fail(400, `PO berstatus ${po.status} tidak dapat menerima barang masuk lagi`);
    }

    // P1 #5: validasi seluruh baris SEBELUM dokumen GR dibuat.
    const itemIds = [...new Set(items.map((row) => row?.item_id).filter(Boolean))];
    const invalidItemId = itemIds.find((itemId) => !UUID_PATTERN.test(String(itemId)));
    if (invalidItemId !== undefined) {
      fail(400, `Format item_id tidak valid: ${invalidItemId}`);
    }

    const uomIds = [
      ...new Set(items.map((row) => row?.uom_id).filter(Boolean)),
    ];
    const invalidUomId = uomIds.find((uomId) => !UUID_PATTERN.test(String(uomId)));
    if (invalidUomId !== undefined) {
      fail(400, `Format uom_id tidak valid: ${invalidUomId}`);
    }

    const [masterItems, masterUoms, priorReceipts] = await Promise.all([
      tx.m_item.findMany({
        where: { id: { in: itemIds } },
        include: { uom: true },
      }),
      uomIds.length > 0
        ? tx.m_uom.findMany({ where: { id: { in: uomIds } } })
        : [],
      tx.t_goods_receipt.findMany({
        where: { po_id },
        include: { details: true },
      }),
    ]);

    const masterItemMap = Object.fromEntries(masterItems.map((item) => [item.id, item]));
    const masterUomMap = Object.fromEntries(masterUoms.map((uom) => [uom.id, uom]));

    const receivedQtyByItem = new Map();
    for (const receipt of priorReceipts) {
      for (const detail of receipt.details || []) {
        const current = receivedQtyByItem.get(detail.item_id) || 0;
        receivedQtyByItem.set(detail.item_id, current + (Number(detail.qty_bagus_pcs) || 0));
      }
    }

    const lines = buildReceiptLines({
      po,
      items,
      masterItems: masterItemMap,
      uoms: masterUomMap,
      receivedQtyByItem,
    });

    const no_gr = `GR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const goodsReceipt = await tx.t_goods_receipt.create({
      data: {
        no_gr,
        po_id,
        no_surat_jalan,
        status: "RECEIVED",
        catatan,
        user_id,
      },
    });

    const grDetails = [];

    for (const line of lines) {
      const grD = await tx.t_goods_receipt_d.create({
        data: {
          gr_id: goodsReceipt.id,
          ...line,
        },
      });
      grDetails.push(grD);

      if (line.qty_bagus_pcs > 0) {
        // 1. Tambah saldo stok gudang di Inventory (t_stock)
        const updatedGudangStock = await tx.t_stock.upsert({
          where: { item_id_location: { item_id: line.item_id, location: "GUDANG" } },
          update: { qty: { increment: line.qty_bagus_pcs } },
          create: {
            item_id: line.item_id,
            location: "GUDANG",
            qty: line.qty_bagus_pcs,
            category_rack_id: masterItemMap[line.item_id]?.category_rack_id ?? null,
          },
        });

        // 2. Catat riwayat kartu stok (t_stock_card)
        await tx.t_stock_card.create({
          data: {
            item_id: line.item_id,
            no_dokumen: no_gr,
            jenis_mutasi: "GR_MASUK",
            qty_in: line.qty_bagus_pcs,
            qty_out: 0,
            saldo_akhir: updatedGudangStock.qty,
            location: "GUDANG",
            user_id,
            keterangan: `Penerimaan Barang Masuk (PO: ${po.no_po}, SJ: ${no_surat_jalan || "-"}) [Ditolak: ${line.qty_ditolak_pcs} Pcs]`,
          },
        });
      }
    }

    // 3. Evaluasi pemenuhan PO: jika seluruh kuantitas terpenuhi, ubah status PO
    //    menjadi COMPLETED (🟢 Selesai), selain itu PARTIAL_RECEIVED.
    const newPoStatus = evaluatePoFulfillment(po, [
      ...priorReceipts,
      { details: grDetails },
    ]);
    await tx.t_purchase_order.update({
      where: { id: po_id },
      data: { status: newPoStatus },
    });

    return {
      ...goodsReceipt,
      details: grDetails,
      po_status: newPoStatus,
      status_label: newPoStatus === "COMPLETED" ? "🟢 Selesai" : "🟠 Diterima Sebagian",
    };
  }, TRANSACTION_OPTIONS);

  await syncAutoPrForItems(
    client,
    (result?.details || []).map((detail) => detail.item_id),
  );
  return result;
}

// 3.1 Daftar Penerimaan Barang (t_goods_receipt)
export async function listGoodsReceipts(query = {}, client = prisma) {
  const { po_id, supplier_id, status, search } = query;
  const where = {};
  if (po_id) where.po_id = po_id;
  if (status) where.status = status;

  const poWhere = {};
  if (supplier_id) poWhere.supplier_id = supplier_id;
  if (search) {
    poWhere.OR = [
      { no_po: { contains: search, mode: "insensitive" } },
      { supplier: { nama_supplier: { contains: search, mode: "insensitive" } } },
    ];
  }
  if (Object.keys(poWhere).length > 0) where.po = poWhere;

  if (search) {
    where.OR = [
      { no_gr: { contains: search, mode: "insensitive" } },
      { no_surat_jalan: { contains: search, mode: "insensitive" } },
    ];
  }

  const receipts = await client.t_goods_receipt.findMany({
    where,
    include: {
      po: { include: { supplier: true } },
      details: { include: { item: { include: { uom: true } }, uom: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return receipts.map((gr) => {
    const totalBagus = gr.details.reduce((acc, d) => acc + d.qty_bagus_pcs, 0);
    const totalDitolak = gr.details.reduce((acc, d) => acc + d.qty_ditolak_pcs, 0);
    return {
      ...gr,
      total_item: gr.details.length,
      total_qty_bagus_pcs: totalBagus,
      total_qty_ditolak_pcs: totalDitolak,
      status_label: gr.status === "VERIFIED" ? "🟢 Terverifikasi" : gr.status === "CANCELLED" ? "🔴 Dibatalkan" : "🟡 Diterima",
    };
  });
}

export async function getGoodsReceiptDetail(id, client = prisma) {
  const receipt = await client.t_goods_receipt.findUnique({
    where: { id },
    include: {
      po: { include: { supplier: true, details: true } },
      details: { include: { item: { include: { uom: true } }, uom: true } },
      invoices: true,
      user: { select: { id: true, name: true } },
    },
  });
  if (!receipt) fail(404, "Penerimaan barang tidak ditemukan");

  return {
    ...receipt,
    total_qty_bagus_pcs: receipt.details.reduce((acc, d) => acc + d.qty_bagus_pcs, 0),
    total_qty_ditolak_pcs: receipt.details.reduce((acc, d) => acc + d.qty_ditolak_pcs, 0),
  };
}

// 3.2 Retur Pembelian (t_purchase_return & t_purchase_return_d)
// Terhubung dengan temuan barang rusak/basi/menggelembung dari rak (Inventory 2.3)
// Menghasilkan "Nota Potong Tagihan" untuk dikirim ke Verifikasi Nota 4.1
export async function createPurchaseReturn(payload, user_id, client = prisma) {
  const { po_id, damaged_id, item_id, qty_pcs, alasan, catatan } = payload;

  if (!UUID_PATTERN.test(String(po_id || ""))) fail(400, "Purchase Order tidak valid");
  if (!UUID_PATTERN.test(String(item_id || ""))) fail(400, "Barang tidak valid");
  if (damaged_id && !UUID_PATTERN.test(String(damaged_id))) {
    fail(400, "Catatan barang rusak tidak valid");
  }

  const result = await client.$transaction(async (tx) => {
    const po = await tx.t_purchase_order.findUnique({
      where: { id: po_id },
      include: {
        supplier: true,
        details: true,
        goods_receipts: { include: { details: true } },
        purchase_returns: { include: { details: true } },
      },
    });

    const item = await tx.m_item.findUnique({ where: { id: item_id } });
    if (!item) fail(404, "Barang tidak ditemukan");

    const qty = Number(qty_pcs);

    // P1 #6: validasi retur terhadap PO/GR/invoice SEBELUM memotong stok.
    const invoice = po
      ? await tx.t_purchase_invoice.findUnique({ where: { po_id } })
      : null;
    assertReturnAllowed({ po, item_id, qty_pcs: qty, invoice });

    let finalDamagedId = damaged_id;

    // Jika belum tercatat di t_stock_damaged, potong stok minimarket sekarang
    if (!finalDamagedId) {
      const rakStock = await tx.t_stock.findUnique({
        where: { item_id_location: { item_id, location: "RAK" } },
      });
      const availRak = rakStock ? rakStock.qty : 0;
      if (availRak < qty) {
        fail(400, `Stok di rak tidak mencukupi untuk retur. Tersedia: ${availRak} Pcs, Diminta: ${qty} Pcs`);
      }

      const updatedRak = await tx.t_stock.update({
        where: { item_id_location: { item_id, location: "RAK" } },
        data: { qty: { decrement: qty } },
      });

      const no_dmg = `DMG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const damagedRecord = await tx.t_stock_damaged.create({
        data: {
          no_damaged: no_dmg,
          item_id,
          category_rack_id: item.category_rack_id,
          location: "RAK",
          qty_pcs: qty,
          kategori: "SUPPLIER_RETURN",
          alasan: alasan || "Basi/Rusak sebelum tanggal expired",
          status: "RETURNED_TO_SUPPLIER",
          user_id,
          catatan,
        },
      });
      finalDamagedId = damagedRecord.id;

      await tx.t_stock_card.create({
        data: {
          item_id,
          no_dokumen: no_dmg,
          jenis_mutasi: "BARANG_RUSAK",
          qty_in: 0,
          qty_out: qty,
          saldo_akhir: updatedRak.qty,
          location: "RAK",
          user_id,
          keterangan: `Retur ke ${po.supplier.nama_supplier} (${alasan || "Basi/Rusak"})`,
        },
      });
    }

    return await issuePurchaseReturn(tx, {
      po_id,
      item_id,
      qty_pcs: qty,
      damaged_id: finalDamagedId,
      user_id,
      catatan: catatan || `Nota Potong Tagihan untuk ${qty} Pcs ${item.nama_barang}`,
    });
  }, TRANSACTION_OPTIONS);

  await syncAutoPrForItem(client, item_id);
  return result;
}

export async function listPurchaseReturns(query = {}) {
  const { status, supplier_id } = query;
  const where = {};
  if (status) where.status = status;
  if (supplier_id) where.supplier_id = supplier_id;

  return await prisma.t_purchase_return.findMany({
    where,
    include: {
      po: true,
      supplier: true,
      damaged_stock: { include: { item: true } },
      details: { include: { item: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// -----------------------------------------------------------------------------
// TAHAP 4: VERIFIKASI TAGIHAN & PELUNASAN HUTANG (KELOMPOK 4)
// -----------------------------------------------------------------------------

// 4.1 Preview 3-Way Matching: Menyandingkan 3 bukti nyata di layar
// 1. Pesanan Awal (PO dari 2.2)
// 2. Bukti Terima Gudang Bagus (dari 3.1)
// 3. Bukti Retur Gudang (dari 3.2)
// -> Menghitung Total Bersih yang Diizinkan untuk Dibayar
// Include standar untuk 3-way matching: PO + seluruh GR + seluruh retur.
const matchingInclude = {
  supplier: true,
  details: { include: { item: { include: { uom: true } } } },
  goods_receipts: { include: { details: true } },
  purchase_returns: { include: { details: true } },
};

async function loadPoForMatching(po_id, client = prisma) {
  return client.t_purchase_order.findUnique({
    where: { id: po_id },
    include: matchingInclude,
  });
}

/**
 * Satu sumber perhitungan untuk 4.1 (preview & eksekusi invoice).
 * Client bisa di-inject (transaksi) atau memakai prisma default.
 */
export async function buildThreeWayMatching(po_id, client = prisma) {
  const po = await loadPoForMatching(po_id, client);
  if (!po) fail(404, "Purchase Order tidak ditemukan");
  return computeThreeWayMatching(po);
}

export async function getThreeWayMatchingPreview(po_id) {
  return await buildThreeWayMatching(po_id);
}

// 4.1 Eksekusi Verifikasi Nota Supplier: Mengunci Total Bersih (1 invoice per PO)
export async function createPurchaseInvoice(payload, user_id, client = prisma) {
  const { po_id, no_invoice_supplier, catatan } = payload;
  if (!po_id) fail(400, "Purchase Order wajib dipilih untuk verifikasi nota");
  if (!UUID_PATTERN.test(String(po_id))) fail(400, "Purchase Order tidak valid");

  try {
    return await client.$transaction(async (tx) => {
      const po = await loadPoForMatching(po_id, tx);
      if (!po) fail(404, "Purchase Order tidak ditemukan");

      // P0 #4: tagihan hanya boleh dikunci setelah seluruh barang diterima.
      if (po.status !== "COMPLETED") {
        fail(
          400,
          `PO ${po.no_po} masih berstatus ${po.status}. Invoice hanya dapat dibuat setelah seluruh barang diterima (COMPLETED).`,
        );
      }

      // P0 #1: satu PO hanya boleh punya satu invoice.
      const existingInvoice = await tx.t_purchase_invoice.findUnique({ where: { po_id } });
      if (existingInvoice) {
        fail(409, `Invoice untuk PO ${po.no_po} sudah pernah dibuat (${existingInvoice.no_invoice})`);
      }

      // P0 #2 & #3: hitung dengan satu fungsi bersama + validasi dokumen milik PO ini.
      const matching = computeThreeWayMatching(po);

      if (!matching.has_receipts) {
        fail(400, `PO ${po.no_po} belum memiliki dokumen Goods Receipt yang dapat ditagihkan`);
      }
      if (matching.unmatched_receipt_item_ids.length > 0) {
        fail(
          400,
          `Ada barang pada Goods Receipt yang tidak terdaftar di PO ini: ${matching.unmatched_receipt_item_ids.join(", ")}`,
        );
      }
      if (matching.unmatched_return_item_ids.length > 0) {
        fail(
          400,
          `Ada barang pada retur yang tidak terdaftar di PO ini: ${matching.unmatched_return_item_ids.join(", ")}`,
        );
      }

      const grossAmount = matching.summary_verifikasi.total_bukti_masuk_bagus_gr;
      const returnDeduction = matching.summary_verifikasi.total_potongan_nota_retur;
      const netPayable = matching.summary_verifikasi.total_bersih_dikunci;
      if (netPayable <= 0) {
        fail(400, "Tidak ada nilai tagihan bersih yang dapat dikunci untuk PO ini");
      }

      // Hitung alarm jatuh tempo sesuai TOP supplier (1.1)
      const topDays = po.supplier?.term_of_payment || 0;
      const tgl_jatuh_tempo = new Date();
      tgl_jatuh_tempo.setDate(tgl_jatuh_tempo.getDate() + topDays);

      const no_invoice =
        no_invoice_supplier || `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const invoice = await tx.t_purchase_invoice.create({
        data: {
          no_invoice,
          po_id,
          gr_id: null, // invoice mewakili seluruh GR pada PO ini
          tgl_jatuh_tempo,
          gross_amount: grossAmount,
          return_deduction: returnDeduction,
          net_payable: netPayable,
          status: "UNPAID",
          catatan,
          user_id,
        },
        include: {
          po: { include: { supplier: true } },
          returns: { include: { details: { include: { item: true } } } },
          payments: true,
        },
      });

      // Tandai seluruh retur ISSUED milik PO ini sebagai sudah tercocokkan ke invoice.
      if (matching.return_ids_issued.length > 0) {
        await tx.t_purchase_return.updateMany({
          where: { id: { in: matching.return_ids_issued }, status: "ISSUED" },
          data: { status: "MATCHED_INVOICE", invoice_id: invoice.id },
        });
      }

      // Ambil ulang agar relasi retur yang baru ditautkan ikut di respons.
      return await tx.t_purchase_invoice.findUnique({
        where: { id: invoice.id },
        include: {
          po: { include: { supplier: true } },
          returns: { include: { details: { include: { item: true } } } },
          payments: true,
        },
      });
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(",")
        : String(error.meta?.target || "");
      if (target.includes("no_invoice")) {
        fail(409, "Nomor invoice sudah digunakan, gunakan nomor lain");
      }
      fail(409, "Invoice untuk PO ini sudah pernah dibuat");
    }
    throw error;
  }
}

export async function listPurchaseInvoices(query = {}) {
  const { status, search } = query;
  const where = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { no_invoice: { contains: search, mode: "insensitive" } },
      { po: { no_po: { contains: search, mode: "insensitive" } } },
    ];
  }

  return await prisma.t_purchase_invoice.findMany({
    where,
    include: {
      po: { include: { supplier: true } },
      returns: { include: { details: { include: { item: true } } } },
      payments: true,
    },
    orderBy: { tgl_jatuh_tempo: "asc" },
  });
}

// 4.2 Jadwal Jatuh Tempo & Alarm Hitung Mundur TOP
export async function listPayablesSchedule(query = {}) {
  const today = new Date();
  const invoices = await prisma.t_purchase_invoice.findMany({
    where: {
      status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
    },
    include: {
      po: { include: { supplier: true } },
      payments: true,
    },
    orderBy: { tgl_jatuh_tempo: "asc" },
  });

  return invoices.map((inv) => {
    const totalPaid = inv.payments.reduce((acc, p) => acc + Number(p.jumlah_bayar), 0);
    const remaining = Number(inv.net_payable) - totalPaid;

    const dueDate = new Date(inv.tgl_jatuh_tempo);
    const diffTime = dueDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let alarmStatus = "AMAN";
    let alarmMessage = `${daysRemaining} hari lagi`;
    if (daysRemaining < 0) {
      alarmStatus = "TERLAMBAT_OVERDUE";
      alarmMessage = `Terlambat ${Math.abs(daysRemaining)} hari`;
    } else if (daysRemaining === 0) {
      alarmStatus = "JATUH_TEMPO_HARI_INI";
      alarmMessage = "Jatuh tempo hari ini!";
    } else if (daysRemaining <= 3) {
      alarmStatus = "SEGERA_JATUH_TEMPO";
      alarmMessage = `Segera bayar: ${daysRemaining} hari lagi`;
    }

    return {
      invoice_id: inv.id,
      no_invoice: inv.no_invoice,
      supplier_name: inv.po.supplier.nama_supplier,
      no_wa_supplier: inv.po.supplier.no_wa,
      top_days: inv.po.supplier.term_of_payment,
      tgl_invoice: inv.tgl_invoice,
      tgl_jatuh_tempo: inv.tgl_jatuh_tempo,
      days_remaining: daysRemaining,
      alarm_status: alarmStatus,
      alarm_message: alarmMessage,
      gross_amount: Number(inv.gross_amount),
      return_deduction: Number(inv.return_deduction),
      net_payable: Number(inv.net_payable),
      total_paid: totalPaid,
      remaining_payable: remaining,
      status: daysRemaining < 0 && remaining > 0 ? "OVERDUE" : inv.status,
    };
  });
}

// 4.2 Tombol "Tandai Lunas" atau Pembayaran Bertahap
export async function createPurchasePayment(payload, user_id) {
  const { invoice_id, jumlah_bayar, metode_bayar = "TRANSFER", no_referensi, catatan } = payload;

  return await prisma.$transaction(async (tx) => {
    const invoice = await tx.t_purchase_invoice.findUnique({
      where: { id: invoice_id },
      include: { po: true, payments: true },
    });
    if (!invoice) fail(404, "Invoice tidak ditemukan");

    const totalPrevPaid = invoice.payments.reduce((acc, p) => acc + Number(p.jumlah_bayar), 0);
    const remainingBefore = Number(invoice.net_payable) - totalPrevPaid;

    // Jika jumlah_bayar tidak diinput, otomatis dianggap pelunasan penuh ("Tandai Lunas")
    const bayarNominal = jumlah_bayar !== undefined ? Number(jumlah_bayar) : remainingBefore;
    if (bayarNominal <= 0) fail(400, "Nominal pembayaran harus lebih dari 0");

    if (bayarNominal > remainingBefore) {
      fail(400, `Jumlah bayar (${bayarNominal}) melebihi sisa tagihan (${remainingBefore})`);
    }

    const no_payment = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const payment = await tx.t_purchase_payment.create({
      data: {
        no_payment,
        invoice_id,
        supplier_id: invoice.po.supplier_id,
        jumlah_bayar: bayarNominal,
        metode_bayar,
        no_referensi,
        status: "SUCCESS",
        catatan: catatan || "Pelunasan tagihan supplier",
        user_id,
      },
    });

    const newTotalPaid = totalPrevPaid + bayarNominal;
    const newStatus = newTotalPaid >= Number(invoice.net_payable) ? "PAID" : "PARTIAL";

    await tx.t_purchase_invoice.update({
      where: { id: invoice_id },
      data: { status: newStatus },
    });

    return {
      payment,
      invoice_status: newStatus,
      status_label: newStatus === "PAID" ? "🟢 Lunas" : "🟠 Sebagian",
      remaining_payable: Number(invoice.net_payable) - newTotalPaid,
    };
  }, TRANSACTION_OPTIONS);
}

// -----------------------------------------------------------------------------
// TAHAP 5: REKAPITULASI PENGELUARAN MODAL TOKO (KELOMPOK 5)
// -----------------------------------------------------------------------------

// 5.1 Laporan Riwayat Pembelian (Satu-satunya laporan resmi purchasing)
// Menarik seluruh data tagihan dari 4.1 dan 4.2 untuk evaluasi belanja modal toko
export async function getPurchaseHistoryReport(query = {}) {
  const { startDate, endDate, supplier_id } = query;
  const where = {};
  // Filter tanggal dari FE dikirim sebagai YYYY-MM-DD. Batas akhir harus
  // mencakup seluruh hari tersebut, bukan hanya pukul 00:00.
  const toStartOfDay = (value) =>
    String(value).length === 10 ? new Date(`${value}T00:00:00.000`) : new Date(value);
  const toEndOfDay = (value) =>
    String(value).length === 10 ? new Date(`${value}T23:59:59.999`) : new Date(value);

  if (startDate || endDate) {
    where.tgl_invoice = {};
    if (startDate) where.tgl_invoice.gte = toStartOfDay(startDate);
    if (endDate) where.tgl_invoice.lte = toEndOfDay(endDate);
  }
  if (supplier_id) where.po = { supplier_id };

  const invoices = await prisma.t_purchase_invoice.findMany({
    where,
    include: {
      po: { include: { supplier: true } },
      payments: true,
      returns: true,
    },
    orderBy: { tgl_invoice: "desc" },
  });

  let totalGross = 0;
  let totalDeduction = 0;
  let totalNet = 0;
  let totalPaid = 0;

  const data = invoices.map((inv) => {
    const paid = inv.payments.reduce((a, b) => a + Number(b.jumlah_bayar), 0);
    totalGross += Number(inv.gross_amount);
    totalDeduction += Number(inv.return_deduction);
    totalNet += Number(inv.net_payable);
    totalPaid += paid;

    return {
      no_invoice: inv.no_invoice,
      no_po: inv.po.no_po,
      supplier: inv.po.supplier.nama_supplier,
      tgl_invoice: inv.tgl_invoice,
      gross_amount: Number(inv.gross_amount),
      return_deduction: Number(inv.return_deduction),
      net_payable: Number(inv.net_payable),
      total_paid: paid,
      remaining: Number(inv.net_payable) - paid,
      status: inv.status,
      status_label: inv.status === "PAID" ? "🟢 Lunas" : "🟠 Belum Lunas",
    };
  });

  return {
    summary: {
      total_invoices: invoices.length,
      total_belanja_kotor: totalGross,
      total_potongan_retur: totalDeduction,
      total_tagihan_bersih: totalNet,
      total_uang_modal_terbayar: totalPaid,
      sisa_hutang_modal: totalNet - totalPaid,
    },
    data,
  };
}
