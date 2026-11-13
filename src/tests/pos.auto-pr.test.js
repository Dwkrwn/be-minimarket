import test from "node:test";
import assert from "node:assert/strict";
import { createAutoPurchaseRequestIfAbsent } from "../../server/modules/pos/pos.service.js";

function buildItem() {
  return {
    id: "item-a",
    nama_barang: "Beras 1kg",
    supplier_catalogs: [
      { supplier_id: "sup-murah", harga_modal: 2400 },
      { supplier_id: "sup-mahal", harga_modal: 2600 },
    ],
  };
}

const PLAN = {
  qtySaranPcs: 96,
  qtySaranBeli: 8,
  totalCurrentStock: 15,
  ropPcs: 40,
};

function createFakeClient({ existingPr = null, activePo = null } = {}) {
  const calls = [];
  const created = [];

  const tx = {
    $executeRaw: async (strings, ...values) => {
      calls.push({ op: "lock", sql: strings.join("?"), values });
      return 1;
    },
    t_purchase_req: {
      findFirst: async (args) => {
        calls.push({ op: "findFirstPr", args });
        return existingPr;
      },
      create: async ({ data }) => {
        calls.push({ op: "createPr", data });
        const record = { id: `pr-${created.length + 1}`, ...data };
        created.push(record);
        return record;
      },
    },
    t_purchase_order: {
      findFirst: async (args) => {
        calls.push({ op: "findFirstPo", args });
        return activePo;
      },
    },
  };

  return {
    calls,
    created,
    client: { $transaction: async (fn) => fn(tx) },
  };
}

test("membuat Auto-PR setelah mengambil kunci advisory per barang", async () => {
  const { calls, created, client } = createFakeClient();

  const result = await createAutoPurchaseRequestIfAbsent(client, {
    item: buildItem(),
    plan: PLAN,
  });

  assert.equal(result.id, "pr-1");
  assert.equal(created.length, 1);
  assert.equal(created[0].status, "PENDING");
  assert.equal(created[0].triggered_by, "AUTO_ROP");
  assert.equal(created[0].supplier_id, "sup-murah");
  assert.equal(created[0].qty_saran_pcs, 96);
  assert.equal(created[0].qty_saran_beli, 8);
  assert.equal(created[0].stok_saat_ini, 15);
  assert.equal(created[0].rop_threshold, 40);

  // Kunci harus diambil SEBELUM pemeriksaan agar tidak balapan.
  assert.equal(calls[0].op, "lock");
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.match(calls[0].sql, /hashtext/);
  assert.deepEqual(calls[0].values, ["auto-pr:item-a"]);
  assert.deepEqual(
    calls.map((call) => call.op),
    ["lock", "findFirstPr", "findFirstPo", "createPr"],
  );
});

test("tidak membuat Auto-PR jika sudah ada PR PENDING", async () => {
  const { created, client } = createFakeClient({
    existingPr: { id: "pr-lama", status: "PENDING" },
  });

  const result = await createAutoPurchaseRequestIfAbsent(client, {
    item: buildItem(),
    plan: PLAN,
  });

  assert.equal(result, null);
  assert.equal(created.length, 0);
});

test("tidak membuat Auto-PR jika sudah ada PO aktif", async () => {
  const { created, client } = createFakeClient({
    activePo: { id: "po-aktif", status: "ORDERED" },
  });

  const result = await createAutoPurchaseRequestIfAbsent(client, {
    item: buildItem(),
    plan: PLAN,
  });

  assert.equal(result, null);
  assert.equal(created.length, 0);
});

test("dua pemanggilan bersamaan hanya menghasilkan satu Auto-PR", async () => {
  const created = [];

  // Mensimulasikan advisory lock: transaksi per barang dijalankan bergantian.
  let tail = Promise.resolve();
  const withLock = (fn) => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    return previous.then(fn).finally(release);
  };

  const makeTx = () => ({
    $executeRaw: async () => 1,
    t_purchase_req: {
      findFirst: async () => created.find((row) => row.status === "PENDING") || null,
      create: async ({ data }) => {
        const record = { id: `pr-${created.length + 1}`, ...data };
        created.push(record);
        return record;
      },
    },
    t_purchase_order: { findFirst: async () => null },
  });

  const client = {
    $transaction: (fn) => withLock(async () => fn(makeTx())),
  };

  const [first, second] = await Promise.all([
    createAutoPurchaseRequestIfAbsent(client, { item: buildItem(), plan: PLAN }),
    createAutoPurchaseRequestIfAbsent(client, { item: buildItem(), plan: PLAN }),
  ]);

  assert.equal(created.length, 1, "hanya satu PR yang boleh terbentuk");
  assert.equal([first, second].filter(Boolean).length, 1);
});
