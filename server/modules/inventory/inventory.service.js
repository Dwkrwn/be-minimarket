import prisma from "../../../src/config/database.js";
import { fail } from "../../../src/core/utils/helpers.js";
import { issuePurchaseReturn } from "../purchasing/purchasing.return.js";
import { syncAutoPrForItem, syncAutoPrForItems } from "../purchasing/autoPr.helper.js";
import { assertDamagedReportAllowed } from "./inventory.damaged.js";
import {
  projectItem,
  projectItems,
  projectRowsWithItem,
} from "./inventory.projection.js";

// =============================================================================
// INVENTORY SERVICE - SISTEM INFORMASI MANAJEMEN MINIMARKET TERINTEGRASI
// =============================================================================

// -----------------------------------------------------------------------------
// 1.2 Kategori & Rak (m_category_rack)
// -----------------------------------------------------------------------------
export async function listCategoryRacks(query = {}) {
  const { tipe_zona, is_active, search } = query;
  const where = {};

  if (tipe_zona) where.tipe_zona = tipe_zona.toUpperCase();
  if (is_active !== undefined) where.is_active = is_active === "true" || is_active === true;
  if (search) {
    where.OR = [
      { kode: { contains: search, mode: "insensitive" } },
      { nama: { contains: search, mode: "insensitive" } },
      { lokasi: { contains: search, mode: "insensitive" } },
    ];
  }

  return await prisma.m_category_rack.findMany({
    where,
    orderBy: [{ tipe_zona: "asc" }, { kode: "asc" }],
  });
}

export async function createCategoryRack(data) {
  const { kode, nama, tipe_zona, lokasi, catatan } = data;
  if (!["GUDANG", "RAK"].includes(tipe_zona?.toUpperCase())) {
    fail(400, "Tipe zona harus bernilai 'GUDANG' atau 'RAK'");
  }
  return await prisma.m_category_rack.create({
    data: {
      kode,
      nama,
      tipe_zona: tipe_zona.toUpperCase(),
      lokasi,
      catatan,
    },
  });
}

export async function updateCategoryRack(id, data) {
  return await prisma.m_category_rack.update({
    where: { id },
    data,
  });
}

export async function deleteCategoryRack(id) {
  return await prisma.m_category_rack.delete({
    where: { id },
  });
}

// -----------------------------------------------------------------------------
// 1.3 Satuan & Konversi (m_uom)
// -----------------------------------------------------------------------------
export async function listUoms(query = {}) {
  const { search } = query;
  const where = {};
  if (search) {
    where.OR = [
      { kode_uom: { contains: search, mode: "insensitive" } },
      { nama_uom: { contains: search, mode: "insensitive" } },
      { satuan_beli: { contains: search, mode: "insensitive" } },
    ];
  }
  return await prisma.m_uom.findMany({
    where,
    orderBy: { kode_uom: "asc" },
  });
}

export async function createUom(data) {
  const { kode_uom, nama_uom, satuan_dasar = "Pcs", satuan_beli, rasio_konversi, catatan } = data;
  if (!rasio_konversi || rasio_konversi < 1) {
    fail(400, "Rasio konversi Kardus ke Pcs harus bernilai minimal 1");
  }
  return await prisma.m_uom.create({
    data: {
      kode_uom,
      nama_uom,
      satuan_dasar,
      satuan_beli,
      rasio_konversi: Number(rasio_konversi),
      catatan,
    },
  });
}

export async function updateUom(id, data) {
  if (data.rasio_konversi !== undefined) {
    data.rasio_konversi = Number(data.rasio_konversi);
    if (data.rasio_konversi < 1) fail(400, "Rasio konversi harus minimal 1");
  }
  return await prisma.m_uom.update({
    where: { id },
    data,
  });
}

export async function deleteUom(id) {
  return await prisma.m_uom.delete({
    where: { id },
  });
}

// -----------------------------------------------------------------------------
// 1.1 Daftar Barang (m_item)
// -----------------------------------------------------------------------------
export async function listItems(query = {}, user = null) {
  const { search, category_rack_id, is_active } = query;
  const where = {};

  if (category_rack_id) where.category_rack_id = category_rack_id;
  if (is_active !== undefined) where.is_active = is_active === "true" || is_active === true;
  if (search) {
    where.OR = [
      { barcode: { contains: search, mode: "insensitive" } },
      { nama_barang: { contains: search, mode: "insensitive" } },
    ];
  }

  const items = await prisma.m_item.findMany({
    where,
    include: {
      category_rack: true,
      uom: true,
      rop_setting: true,
      stocks: true,
    },
    orderBy: { nama_barang: "asc" },
  });

  return projectItems(items, user);
}

export async function getItemByBarcode(barcode, user = null) {
  const item = await prisma.m_item.findUnique({
    where: { barcode },
    include: {
      category_rack: true,
      uom: true,
      stocks: true,
      rop_setting: true,
    },
  });
  if (!item) fail(404, `Barang dengan barcode '${barcode}' tidak ditemukan`);
  return projectItem(item, user);
}

export async function getItemById(id, user = null) {
  const item = await prisma.m_item.findUnique({
    where: { id },
    include: {
      category_rack: true,
      uom: true,
      stocks: true,
      rop_setting: true,
      supplier_catalogs: {
        include: { supplier: true },
      },
    },
  });
  if (!item) fail(404, "Data barang tidak ditemukan");
  return projectItem(item, user);
}

export async function createItem(data) {
  const {
    barcode,
    nama_barang,
    category_rack_id,
    uom_id,
    harga_modal = 0,
    harga_jual = 0,
    catatan,
    lead_time_days = 3,
    safety_stock_pcs = 10,
    max_stock_pcs = 100,
  } = data;

  const createdItem = await prisma.$transaction(async (tx) => {
    const item = await tx.m_item.create({
      data: {
        barcode,
        nama_barang,
        category_rack_id,
        uom_id,
        harga_modal,
        harga_jual,
        catatan,
      },
    });

    // Inisialisasi slot saldo t_stock untuk GUDANG dan RAK dengan nilai 0 Pcs
    await tx.t_stock.createMany({
      data: [
        { item_id: item.id, location: "GUDANG", qty: 0, category_rack_id },
        { item_id: item.id, location: "RAK", qty: 0, category_rack_id },
      ],
    });

    // Inisialisasi pengaturan ROP default (Inventory 4.1)
    await tx.m_item_rop.create({
      data: {
        item_id: item.id,
        lead_time_days: Number(lead_time_days),
        safety_stock_pcs: Number(safety_stock_pcs),
        max_stock_pcs: Number(max_stock_pcs),
        avg_daily_sales: 0,
        rop_pcs: Number(safety_stock_pcs),
        is_auto_pr: true,
      },
    });

    return item;
  });

  await syncAutoPrForItem(prisma, createdItem.id);
  return createdItem;
}

export async function updateItem(id, data) {
  const item = await prisma.m_item.update({
    where: { id },
    data,
  });
  await syncAutoPrForItem(prisma, item.id);
  return item;
}

export async function deleteItem(id) {
  try {
    return await prisma.m_item.delete({
      where: { id },
    });
  } catch (error) {
    if (error.code === "P2003") {
      fail(
        409,
        "Barang tidak dapat dihapus permanen karena sudah memiliki riwayat transaksi (PO, penerimaan gudang, mutasi, atau penjualan kasir). Gunakan fitur ubah status menjadi 'Nonaktif' jika produk sudah tidak dijual.",
      );
    }
    throw error;
  }
}

// -----------------------------------------------------------------------------
// 2.1 Posisi Stok Real-Time (t_stock)
// -----------------------------------------------------------------------------
export async function getStockPositions(query = {}, user = null) {
  const { location, category_rack_id, search } = query;
  const where = {};

  if (location) where.location = location.toUpperCase();
  if (category_rack_id) where.category_rack_id = category_rack_id;
  if (search) {
    where.item = {
      OR: [
        { barcode: { contains: search, mode: "insensitive" } },
        { nama_barang: { contains: search, mode: "insensitive" } },
      ],
    };
  }

  const stocks = await prisma.t_stock.findMany({
    where,
    include: {
      item: {
        include: {
          category_rack: true,
          uom: true,
          rop_setting: true,
        },
      },
      category_rack: true,
    },
    orderBy: [{ item: { nama_barang: "asc" } }, { location: "asc" }],
  });

  return projectRowsWithItem(stocks, user);
}

// -----------------------------------------------------------------------------
// 2.4 Kartu Stok Kronologis (t_stock_card)
// -----------------------------------------------------------------------------
export async function getStockCards(query = {}, user = null) {
  const { item_id, location, startDate, endDate, page = 1, limit = 50 } = query;
  const where = {};

  if (item_id) where.item_id = item_id;
  if (location) where.location = location.toUpperCase();
  if (startDate || endDate) {
    where.tanggal = {};
    if (startDate) where.tanggal.gte = new Date(startDate);
    if (endDate) where.tanggal.lte = new Date(endDate);
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [total, data] = await Promise.all([
    prisma.t_stock_card.count({ where }),
    prisma.t_stock_card.findMany({
      where,
      include: {
        item: { include: { uom: true } },
        user: { select: { id: true, name: true, username: true } },
      },
      orderBy: { tanggal: "desc" },
      skip,
      take: Number(limit),
    }),
  ]);

  return { total, page: Number(page), limit: Number(limit), data: projectRowsWithItem(data, user) };
}

// -----------------------------------------------------------------------------
// 2.2 Transaksi Atomik: Mutasi Gudang ke Rak (t_stock_mutation) [KRUSIAL 2]
// -----------------------------------------------------------------------------
export async function executeStockMutationTransaction(payload, user_id) {
  const { items, keterangan } = payload;
  if (!items || !Array.isArray(items) || items.length === 0) {
    fail(400, "Daftar barang mutasi tidak boleh kosong");
  }

  return await prisma.$transaction(async (tx) => {
    const no_mutasi = `MUT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const mutation = await tx.t_stock_mutation.create({
      data: {
        no_mutasi,
        from_location: "GUDANG",
        to_location: "RAK",
        status: "COMPLETED",
        keterangan,
        user_id,
      },
    });

    const mutationDetails = [];

    for (const entry of items) {
      const { item_id, qty_pcs } = entry;
      const qty = Number(qty_pcs);

      if (!qty || qty <= 0) {
        fail(400, `Kuantitas mutasi untuk item ${item_id} harus lebih dari 0`);
      }

      const item = await tx.m_item.findUnique({
        where: { id: item_id },
      });
      if (!item) fail(404, `Barang dengan ID ${item_id} tidak ditemukan`);

      // 1. Validasi kecukupan saldo di GUDANG
      const gudangStock = await tx.t_stock.findUnique({
        where: { item_id_location: { item_id, location: "GUDANG" } },
      });

      const currentGudangQty = gudangStock ? gudangStock.qty : 0;
      if (currentGudangQty < qty) {
        fail(
          400,
          `Stok Gudang untuk '${item.nama_barang}' tidak mencukupi. Tersedia: ${currentGudangQty} Pcs, Diminta: ${qty} Pcs`,
        );
      }

      // 2. Kurangi saldo Gudang
      const updatedGudang = await tx.t_stock.update({
        where: { item_id_location: { item_id, location: "GUDANG" } },
        data: { qty: { decrement: qty } },
      });

      // 3. Tambah saldo Rak
      const updatedRak = await tx.t_stock.upsert({
        where: { item_id_location: { item_id, location: "RAK" } },
        update: { qty: { increment: qty } },
        create: {
          item_id,
          location: "RAK",
          qty,
          category_rack_id: item.category_rack_id,
        },
      });

      // 4. Catat detail mutasi
      const detail = await tx.t_stock_mutation_d.create({
        data: {
          mutation_id: mutation.id,
          item_id,
          qty_pcs: qty,
        },
      });
      mutationDetails.push(detail);

      // 5. Catat 2 kartu stok: KELUAR dari Gudang & MASUK ke Rak
      await tx.t_stock_card.create({
        data: {
          item_id,
          no_dokumen: no_mutasi,
          jenis_mutasi: "MUTASI_KELUAR",
          qty_in: 0,
          qty_out: qty,
          saldo_akhir: updatedGudang.qty,
          location: "GUDANG",
          user_id,
          keterangan: `Mutasi ke Rak Pajangan (${keterangan || "-"})`,
        },
      });

      await tx.t_stock_card.create({
        data: {
          item_id,
          no_dokumen: no_mutasi,
          jenis_mutasi: "MUTASI_MASUK",
          qty_in: qty,
          qty_out: 0,
          saldo_akhir: updatedRak.qty,
          location: "RAK",
          user_id,
          keterangan: `Penerimaan Mutasi dari Gudang Belakang (${keterangan || "-"})`,
        },
      });
    }

    return {
      ...mutation,
      details: mutationDetails,
    };
  });
}

// -----------------------------------------------------------------------------
// 2.3 Transaksi Atomik: Barang Rusak / Hilang (t_stock_damaged) [KRUSIAL 3 - Titik Masuk]
// -----------------------------------------------------------------------------
export async function executeStockDamagedTransaction(payload, actor, client = prisma) {
  const { item_id, location = "RAK", qty_pcs, kategori, alasan, catatan, po_id } = payload;
  const qty = Number(qty_pcs);
  const actorUser = actor && typeof actor === "object" ? actor : null;
  const user_id = actorUser?.id ?? (typeof actor === "string" ? actor : null);

  assertDamagedReportAllowed({ user: actorUser, location, po_id });

  if (!qty || qty <= 0) fail(400, "Kuantitas barang rusak harus lebih dari 0");
  if (!["INTERNAL_LOSS", "SUPPLIER_RETURN"].includes(kategori)) {
    fail(400, "Kategori harus 'INTERNAL_LOSS' (kerugian toko) atau 'SUPPLIER_RETURN' (retur pemasok)");
  }

  const result = await client.$transaction(async (tx) => {
    const item = await tx.m_item.findUnique({
      where: { id: item_id },
      include: { uom: true },
    });
    if (!item) fail(404, "Barang tidak ditemukan");

    // 1. Validasi ketersediaan stok di lokasi yang dilaporkan
    const currentStock = await tx.t_stock.findUnique({
      where: { item_id_location: { item_id, location: location.toUpperCase() } },
    });

    const availQty = currentStock ? currentStock.qty : 0;
    if (availQty < qty) {
      fail(
        400,
        `Stok di ${location} tidak mencukupi untuk pemotongan barang rusak. Tersedia: ${availQty} Pcs, Diminta: ${qty} Pcs`,
      );
    }

    // 2. Potong stok dari lokasi
    const updatedStock = await tx.t_stock.update({
      where: { item_id_location: { item_id, location: location.toUpperCase() } },
      data: { qty: { decrement: qty } },
    });

    const no_damaged = `DMG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // 3. Catat di t_stock_damaged
    const damaged = await tx.t_stock_damaged.create({
      data: {
        no_damaged,
        item_id,
        category_rack_id: item.category_rack_id,
        location: location.toUpperCase(),
        qty_pcs: qty,
        kategori,
        alasan,
        status: kategori === "SUPPLIER_RETURN" ? "RETURNED_TO_SUPPLIER" : "WRITTEN_OFF",
        user_id,
        catatan,
      },
    });

    // 4. Tulis kartu stok
    await tx.t_stock_card.create({
      data: {
        item_id,
        no_dokumen: no_damaged,
        jenis_mutasi: "BARANG_RUSAK",
        qty_in: 0,
        qty_out: qty,
        saldo_akhir: updatedStock.qty,
        location: location.toUpperCase(),
        user_id,
        keterangan: `Barang Rusak/Hilang: [${kategori}] ${alasan}`,
      },
    });

    // 5. Jika kategori SUPPLIER_RETURN dan ada po_id, terbitkan retur pembelian Purchasing 3.2.
    //    Temuan barang rusak tetap tersimpan walau nota retur tidak dapat diterbitkan
    //    (mis. barang belum diterima atau invoice PO sudah terbit), agar laporan 2.3 tidak gagal.
    let purchaseReturn = null;
    let purchaseReturnError = null;
    if (kategori === "SUPPLIER_RETURN" && po_id) {
      try {
        purchaseReturn = await issuePurchaseReturn(tx, {
          po_id,
          item_id,
          qty_pcs: qty,
          damaged_id: damaged.id,
          user_id,
          catatan: `Retur otomatis dari temuan barang rusak ${no_damaged}`,
        });
      } catch (error) {
        if (!error.status || error.status >= 500) throw error;
        purchaseReturnError = error.message;
      }
    }

    return {
      damaged,
      purchaseReturn,
      purchase_return_error: purchaseReturnError,
    };
  });

  await syncAutoPrForItem(client, item_id);
  return result;
}

export async function listDamagedStocks(query = {}, user = null) {
  const { kategori, status, search } = query;
  const where = {};
  if (kategori) where.kategori = kategori;
  if (status) where.status = status;
  if (search) {
    where.item = {
      OR: [
        { barcode: { contains: search, mode: "insensitive" } },
        { nama_barang: { contains: search, mode: "insensitive" } },
      ],
    };
  }

  const damagedStocks = await prisma.t_stock_damaged.findMany({
    where,
    include: {
      item: { include: { uom: true } },
      category_rack: true,
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return projectRowsWithItem(damagedStocks, user);
}

// -----------------------------------------------------------------------------
// 3.1 Hitung Fisik / Stock Opname (t_stock_opname)
// -----------------------------------------------------------------------------
const OPNAME_USER_SELECT = { id: true, name: true, username: true };

function normalizeOpnameLocation(location) {
  const value = String(location || "RAK").toUpperCase();
  if (!["GUDANG", "RAK"].includes(value)) {
    fail(400, "Lokasi opname harus bernilai 'GUDANG' atau 'RAK'");
  }
  return value;
}

function normalizePaging(query = {}, defaultLimit = 50) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || defaultLimit));
  return { page, limit };
}

export async function listStockOpnames(query = {}) {
  const { status, location, search } = query;
  const { page, limit } = normalizePaging(query);
  const where = {};

  if (status) where.status = String(status).toUpperCase();
  if (location) {
    where.details = { some: { location: normalizeOpnameLocation(location) } };
  }
  if (search) {
    where.OR = [
      { no_opname: { contains: search, mode: "insensitive" } },
      { catatan: { contains: search, mode: "insensitive" } },
      {
        details: {
          some: {
            item: {
              OR: [
                { barcode: { contains: search, mode: "insensitive" } },
                { nama_barang: { contains: search, mode: "insensitive" } },
              ],
            },
          },
        },
      },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.t_stock_opname.count({ where }),
    prisma.t_stock_opname.findMany({
      where,
      include: {
        user: { select: OPNAME_USER_SELECT },
        approver: { select: OPNAME_USER_SELECT },
        details: {
          select: { location: true, qty_sistem: true, qty_fisik: true, selisih: true },
        },
        _count: { select: { details: true, adjustments: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const data = rows.map((row) => {
    const { details, _count, ...header } = row;
    return {
      ...header,
      locations: [...new Set(details.map((detail) => detail.location))],
      total_item: _count.details,
      total_adjustment: _count.adjustments,
      item_selisih: details.filter((detail) => detail.selisih !== 0).length,
      qty_selisih: details.reduce((sum, detail) => sum + Math.abs(detail.selisih), 0),
      qty_fisik: details.reduce((sum, detail) => sum + detail.qty_fisik, 0),
    };
  });

  return { total, page, limit, data };
}

export async function getStockOpnameDetail(id, user = null) {
  const opname = await prisma.t_stock_opname.findUnique({
    where: { id },
    include: {
      user: { select: OPNAME_USER_SELECT },
      approver: { select: OPNAME_USER_SELECT },
      details: {
        include: {
          item: { include: { category_rack: true, uom: true } },
          category_rack: true,
        },
        orderBy: { item: { nama_barang: "asc" } },
      },
      adjustments: {
        include: {
          user: { select: OPNAME_USER_SELECT },
          details: { include: { item: { include: { uom: true } } } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!opname) fail(404, "Dokumen stock opname tidak ditemukan");

  return {
    ...opname,
    details: projectRowsWithItem(opname.details, user),
    adjustments: opname.adjustments.map((adjustment) => ({
      ...adjustment,
      details: projectRowsWithItem(adjustment.details, user),
    })),
  };
}

export async function listStockAdjustments(query = {}, user = null) {
  const { opname_id } = query;
  const { page, limit } = normalizePaging(query);
  const where = {};
  if (opname_id) where.opname_id = opname_id;

  const [total, rows] = await Promise.all([
    prisma.t_stock_adjustment.count({ where }),
    prisma.t_stock_adjustment.findMany({
      where,
      include: {
        opname: { select: { id: true, no_opname: true } },
        user: { select: OPNAME_USER_SELECT },
        details: { include: { item: { include: { uom: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    total,
    page,
    limit,
    data: rows.map((row) => ({
      ...row,
      details: projectRowsWithItem(row.details, user),
    })),
  };
}

export async function deleteStockOpnameDraft(id) {
  const opname = await prisma.t_stock_opname.findUnique({
    where: { id },
    select: { id: true, no_opname: true, status: true },
  });

  if (!opname) fail(404, "Dokumen stock opname tidak ditemukan");
  if (opname.status !== "DRAFT") {
    fail(
      400,
      `Opname ${opname.no_opname} berstatus ${opname.status}. Hanya draft yang boleh dihapus.`,
    );
  }

  await prisma.t_stock_opname.delete({ where: { id } });
  return { id: opname.id, no_opname: opname.no_opname };
}

export async function createStockOpnameDraft(payload, user_id) {
  const { catatan, location = "RAK", category_rack_id } = payload;
  const normalizedLocation = normalizeOpnameLocation(location);

  return await prisma.$transaction(async (tx) => {
    const no_opname = `OPN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Rak yang dipilih harus berada pada zona lokasi yang dihitung,
    // agar draft tidak mencampur barang gudang ke lembar hitung rak.
    if (category_rack_id) {
      const rack = await tx.m_category_rack.findUnique({
        where: { id: category_rack_id },
        select: { kode: true, nama: true, tipe_zona: true, is_active: true },
      });
      if (!rack) fail(400, "Kategori/rak tidak ditemukan");
      if (!rack.is_active) fail(400, `Kategori/rak ${rack.kode} tidak aktif`);
      if (rack.tipe_zona !== normalizedLocation) {
        fail(
          400,
          `Rak ${rack.kode} bertipe ${rack.tipe_zona}, bukan ${normalizedLocation}`,
        );
      }
    }

    // Draft memuat SEMUA barang aktif pada lokasi terpilih, termasuk barang
    // yang belum punya baris t_stock (qty_sistem = 0), agar temuan hitung fisik
    // atas barang kosong tetap tercatat.
    const itemWhere = { is_active: true };
    if (category_rack_id) {
      itemWhere.OR = [
        { category_rack_id },
        { stocks: { some: { location: normalizedLocation, category_rack_id } } },
      ];
    }

    const [items, stocks] = await Promise.all([
      tx.m_item.findMany({
        where: itemWhere,
        orderBy: { nama_barang: "asc" },
      }),
      tx.t_stock.findMany({
        where: {
          location: normalizedLocation,
          ...(category_rack_id ? { category_rack_id } : {}),
        },
      }),
    ]);

    const stockByItem = new Map(stocks.map((stock) => [stock.item_id, stock]));

    const opname = await tx.t_stock_opname.create({
      data: {
        no_opname,
        status: "DRAFT",
        catatan,
        user_id,
      },
    });

    if (items.length > 0) {
      await tx.t_stock_opname_d.createMany({
        data: items.map((item) => {
          const stock = stockByItem.get(item.id);
          const qtySistem = stock ? stock.qty : 0;
          return {
            opname_id: opname.id,
            item_id: item.id,
            category_rack_id: stock?.category_rack_id ?? item.category_rack_id ?? null,
            location: normalizedLocation,
            qty_sistem: qtySistem,
            qty_fisik: qtySistem, // default fisik sama sebelum diisi petugas
            selisih: 0,
          };
        }),
      });
    }

    const opnameDetails = await tx.t_stock_opname_d.findMany({
      where: { opname_id: opname.id },
      include: { item: { include: { category_rack: true, uom: true } } },
      orderBy: { item: { nama_barang: "asc" } },
    });

    return {
      ...opname,
      total_item: opnameDetails.length,
      details: opnameDetails,
    };
  });
}

export async function submitStockOpnameCounts(opname_id, countsPayload, user_id) {
  // countsPayload: [{ detail_id, qty_fisik, catatan }]
  if (!Array.isArray(countsPayload) || countsPayload.length === 0) {
    fail(400, "Daftar hasil hitung fisik tidak boleh kosong");
  }

  return await prisma.$transaction(async (tx) => {
    const opname = await tx.t_stock_opname.findUnique({
      where: { id: opname_id },
      include: { details: true },
    });
    if (!opname) fail(404, "Dokumen stock opname tidak ditemukan");
    if (opname.status !== "DRAFT") fail(400, "Hanya opname berstatus DRAFT yang dapat disubmit");

    for (const count of countsPayload) {
      const detail = opname.details.find((d) => d.id === count.detail_id);
      if (!detail) {
        fail(400, `Baris opname dengan ID ${count.detail_id} bukan bagian dari dokumen ini`);
      }

      const fisik = Number(count.qty_fisik);
      if (!Number.isInteger(fisik) || fisik < 0) {
        fail(400, `Qty fisik untuk barang ${detail.item_id} harus berupa bilangan bulat >= 0`);
      }

      await tx.t_stock_opname_d.update({
        where: { id: detail.id },
        data: {
          qty_fisik: fisik,
          selisih: fisik - detail.qty_sistem,
          catatan: count.catatan,
        },
      });
    }

    return await tx.t_stock_opname.update({
      where: { id: opname_id },
      data: { status: "SUBMITTED" },
      include: { details: { include: { item: true } } },
    });
  });
}

// -----------------------------------------------------------------------------
// 3.2 Transaksi Atomik: Penyesuaian Stok / Adjustment (t_stock_adjustment) [KRUSIAL 4]
// -----------------------------------------------------------------------------
export async function executeStockAdjustmentTransaction(opname_id, user_id, catatan) {
  const result = await prisma.$transaction(async (tx) => {
    const opname = await tx.t_stock_opname.findUnique({
      where: { id: opname_id },
      include: { details: { include: { item: true } } },
    });

    if (!opname) fail(404, "Stock opname tidak ditemukan");
    if (opname.status === "APPROVED") fail(400, "Opname ini sudah disetujui sebelumnya");
    if (opname.status !== "SUBMITTED") {
      fail(
        400,
        "Hanya opname berstatus SUBMITTED yang dapat disesuaikan. Simpan hasil hitung fisik terlebih dahulu.",
      );
    }

    // Hanya barang yang selisih fisik vs sistem yang dikoreksi
    const discrepantItems = opname.details.filter((d) => d.selisih !== 0);
    const adjustmentDetails = [];

    let adjustment = null;
    let no_adjustment = null;

    if (discrepantItems.length > 0) {
      no_adjustment = `ADJ-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      adjustment = await tx.t_stock_adjustment.create({
        data: {
          no_adjustment,
          opname_id,
          status: "APPLIED",
          catatan: catatan || `Penyesuaian stok dari Opname ${opname.no_opname}`,
          user_id,
        },
      });

      for (const itemDetail of discrepantItems) {
        const { item_id, location, selisih, qty_fisik } = itemDetail;
        const direction = selisih > 0 ? "IN" : "OUT";
        const absQty = Math.abs(selisih);

        // 1. Simpan detail adjustment
        const adjD = await tx.t_stock_adjustment_d.create({
          data: {
            adjustment_id: adjustment.id,
            item_id,
            location,
            qty_adjustment: absQty,
            direction,
          },
        });
        adjustmentDetails.push(adjD);

        // 2. Koreksi saldo t_stock agar setara dengan kuantitas fisik lapangan
        await tx.t_stock.upsert({
          where: { item_id_location: { item_id, location } },
          update: { qty: qty_fisik },
          create: {
            item_id,
            location,
            qty: qty_fisik,
            category_rack_id: itemDetail.category_rack_id,
          },
        });

        // 3. Rekam jejak bukti koreksi ke t_stock_card
        await tx.t_stock_card.create({
          data: {
            item_id,
            no_dokumen: no_adjustment,
            jenis_mutasi: "OPNAME_ADJUST",
            qty_in: direction === "IN" ? absQty : 0,
            qty_out: direction === "OUT" ? absQty : 0,
            saldo_akhir: qty_fisik,
            location,
            user_id,
            keterangan: `Koreksi Hasil Stock Opname (${opname.no_opname}) [Selisih: ${selisih > 0 ? "+" : ""}${selisih} Pcs]`,
          },
        });
      }
    }

    // 4. Update status opname menjadi APPROVED (tanpa menyentuh modul purchasing)
    await tx.t_stock_opname.update({
      where: { id: opname_id },
      data: {
        status: "APPROVED",
        approved_by: user_id,
        approved_at: new Date(),
      },
    });

    return {
      adjustment,
      no_adjustment,
      total_selisih: adjustmentDetails.length,
      details: adjustmentDetails,
    };
  });

  await syncAutoPrForItems(
    prisma,
    (result?.details || []).map((detail) => detail.item_id),
  );
  return result;
}

// -----------------------------------------------------------------------------
// 4.1 Pengaturan Batas Pemesanan Barang / ROP (m_item_rop)
// -----------------------------------------------------------------------------
export async function getRopSettings(query = {}, user = null) {
  const { search } = query;
  const where = {};
  if (search) {
    where.item = {
      OR: [
        { barcode: { contains: search, mode: "insensitive" } },
        { nama_barang: { contains: search, mode: "insensitive" } },
      ],
    };
  }

  const ropSettings = await prisma.m_item_rop.findMany({
    where,
    include: {
      item: {
        include: {
          uom: true,
          stocks: true,
        },
      },
    },
    orderBy: { item: { nama_barang: "asc" } },
  });

  return projectRowsWithItem(ropSettings, user);
}

export async function updateRopSetting(item_id, payload) {
  const { lead_time_days, safety_stock_pcs, max_stock_pcs, is_auto_pr } = payload;
  const ropData = await prisma.m_item_rop.findUnique({ where: { item_id } });

  const leadTime = lead_time_days !== undefined ? Number(lead_time_days) : (ropData?.lead_time_days || 3);
  const safetyStock = safety_stock_pcs !== undefined ? Number(safety_stock_pcs) : (ropData?.safety_stock_pcs || 10);
  const avgSales = ropData ? Number(ropData.avg_daily_sales) : 0;

  // Rumus ROP: (rata-rata penjualan harian x waktu tunggu) + stok pengaman
  const rop_pcs = Math.ceil(avgSales * leadTime + safetyStock);

  const ropSetting = await prisma.m_item_rop.upsert({
    where: { item_id },
    update: {
      lead_time_days: leadTime,
      safety_stock_pcs: safetyStock,
      max_stock_pcs: max_stock_pcs !== undefined ? Number(max_stock_pcs) : (ropData?.max_stock_pcs || 100),
      is_auto_pr: is_auto_pr !== undefined ? Boolean(is_auto_pr) : true,
      rop_pcs,
      last_calculated_at: new Date(),
    },
    create: {
      item_id,
      lead_time_days: leadTime,
      safety_stock_pcs: safetyStock,
      max_stock_pcs: max_stock_pcs !== undefined ? Number(max_stock_pcs) : 100,
      is_auto_pr: is_auto_pr !== undefined ? Boolean(is_auto_pr) : true,
      rop_pcs,
      last_calculated_at: new Date(),
    },
    include: { item: true },
  });

  await syncAutoPrForItem(prisma, item_id);
  return ropSetting;
}

