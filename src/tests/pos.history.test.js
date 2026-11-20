// Riwayat transaksi pada shift aktif — akses, proyeksi, dan pagination.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_HISTORY_DEFAULT_LIMIT,
  ORDER_HISTORY_MAX_LIMIT,
  getActiveShiftOrders,
  parseOrderHistoryQuery,
  projectHistoryOrder,
} from "../../server/modules/pos/pos.service.js";

const KASIR = { id: "kasir-1", role: { system_key: "KASIR" } };
const KASIR_LAIN = { id: "kasir-2", role: { system_key: "KASIR" } };

const FORBIDDEN_KEYS = [
  "ekspektasi_kas_laci",
  "total_omzet",
  "total_tunai",
  "total_non_tunai",
  "selisih",
  "total_transaksi",
  "omzet_per_metode",
];

function buildOrder(overrides = {}) {
  return {
    id: "order-1",
    no_struk: "STR-001",
    shift_id: "shift-1",
    user_id: KASIR.id,
    createdAt: new Date("2026-11-18T07:00:00Z"),
    metode_bayar: "TUNAI",
    status: "COMPLETED",
    total_amount: "25000",
    bayar: "30000",
    kembalian: "5000",
    catatan: "Pelanggan pertama",
    details: [
      {
        id: "detail-1",
        item_id: "item-1",
        qty_pcs: 2,
        harga_satuan: "12000",
        diskon: "1000",
        subtotal: "23000",
        item: {
          id: "item-1",
          barcode: "8999000000001",
          nama_barang: "Air mineral",
          harga_jual: "12000",
          is_active: true,
        },
      },
      {
        id: "detail-2",
        item_id: "item-2",
        qty_pcs: 1,
        harga_satuan: "2000",
        diskon: "0",
        subtotal: "2000",
        item: {
          id: "item-2",
          barcode: "8999000000002",
          nama_barang: "Permen",
          harga_jual: "2000",
          is_active: true,
        },
      },
    ],
    ...overrides,
  };
}

function buildClient({ shiftUserId = KASIR.id, orders = [buildOrder()], findManyCalls = [] } = {}) {
  return {
    t_cashier_shift: {
      findFirst: async ({ where }) =>
        where.user_id === shiftUserId && where.status === "OPEN"
          ? { id: "shift-1", no_shift: "SFT-001" }
          : null,
    },
    t_pos_order: {
      findMany: async (args) => {
        findManyCalls.push(args);
        return orders;
      },
    },
  };
}

test("parseOrderHistoryQuery memakai batas wajar dan membersihkan cursor", () => {
  assert.deepEqual(parseOrderHistoryQuery({}), {
    limit: ORDER_HISTORY_DEFAULT_LIMIT,
    cursor: null,
  });
  assert.deepEqual(parseOrderHistoryQuery({ limit: "3", cursor: "  order-9  " }), {
    limit: 3,
    cursor: "order-9",
  });
  assert.deepEqual(parseOrderHistoryQuery({ limit: "9999" }), {
    limit: ORDER_HISTORY_MAX_LIMIT,
    cursor: null,
  });
  assert.equal(parseOrderHistoryQuery({ limit: "bukan-angka" }).limit, ORDER_HISTORY_DEFAULT_LIMIT);
  assert.equal(parseOrderHistoryQuery({ limit: "-5" }).limit, ORDER_HISTORY_DEFAULT_LIMIT);
});

test("projectHistoryOrder mengubah Decimal dan menghitung jumlah item", () => {
  const projected = projectHistoryOrder(buildOrder());

  assert.equal(projected.total_amount, 25000);
  assert.equal(projected.bayar, 30000);
  assert.equal(projected.kembalian, 5000);
  assert.equal(projected.item_count, 3);
  assert.equal(projected.details[0].harga_satuan, 12000);
  assert.equal(projected.details[0].item.nama_barang, "Air mineral");
  assert.equal("harga_modal" in projected.details[0].item, false);
  assert.equal("orders" in projected, false);
});

test("riwayat kosong bila kasir tidak punya shift OPEN", async () => {
  const findManyCalls = [];
  const client = buildClient({ shiftUserId: KASIR_LAIN.id, findManyCalls });

  const result = await getActiveShiftOrders(KASIR, {}, client);

  assert.deepEqual(result, {
    no_shift: null,
    orders: [],
    has_more: false,
    next_cursor: null,
  });
  assert.equal(findManyCalls.length, 0, "tidak boleh mengambil order tanpa shift milik sendiri");
});

test("riwayat menampilkan transaksi milik shift aktif tanpa agregat kas", async () => {
  const client = buildClient();

  const result = await getActiveShiftOrders(KASIR, { limit: 20 }, client);

  assert.equal(result.no_shift, "SFT-001");
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].no_struk, "STR-001");
  assert.equal(result.orders[0].item_count, 3);
  assert.equal(result.has_more, false);
  assert.equal(result.next_cursor, null);

  for (const key of FORBIDDEN_KEYS) {
    assert.equal(key in result, false, `${key} tidak boleh muncul di riwayat`);
    assert.equal(key in result.orders[0], false, `${key} tidak boleh muncul per order`);
  }
});

test("riwayat memakai pagination cursor dan mengembalikan next_cursor", async () => {
  const findManyCalls = [];
  const order2Id = "00000000-0000-4000-8000-000000000002";
  const order1Id = "00000000-0000-4000-8000-000000000001";
  const orders = [
    buildOrder({ id: order2Id, no_struk: "STR-002" }),
    buildOrder({ id: order1Id, no_struk: "STR-001" }),
  ];
  const client = buildClient({ orders, findManyCalls });

  const result = await getActiveShiftOrders(KASIR, { limit: 1 }, client);

  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].id, order2Id);
  assert.equal(result.has_more, true);
  assert.equal(result.next_cursor, order2Id);

  const args = findManyCalls[0];
  assert.equal(args.take, 2);
  assert.deepEqual(args.where, { shift_id: "shift-1" });
  assert.deepEqual(args.orderBy, [
    { createdAt: "desc" },
    { id: "desc" },
  ]);

  const nextPageClient = buildClient({ orders: [orders[1]], findManyCalls });
  const nextPage = await getActiveShiftOrders(KASIR, { limit: 1, cursor: order2Id }, nextPageClient);
  assert.equal(nextPage.orders[0].id, order1Id);
  assert.deepEqual(findManyCalls[1].cursor, { id: order2Id });
  assert.equal(findManyCalls[1].skip, 1);
});

test("riwayat menolak permintaan tanpa pengguna", async () => {
  await assert.rejects(
    getActiveShiftOrders(null, {}, buildClient()),
    (error) => error.status === 401,
  );
});

test("riwayat menolak cursor bukan UUID sebelum menyentuh database", async () => {
  const findManyCalls = [];
  const client = buildClient({ findManyCalls });

  await assert.rejects(
    getActiveShiftOrders(KASIR, { cursor: "bukan-uuid" }, client),
    (error) => error.status === 400,
  );
  assert.equal(findManyCalls.length, 0);
});
