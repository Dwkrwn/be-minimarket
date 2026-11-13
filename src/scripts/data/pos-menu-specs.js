// Sumber tunggal susunan menu POS (Transaksi) sesuai rancangan 5 halaman final.
// Dipakai oleh script sinkronisasi menu POS.
// Path wajib sama dengan route FE di src/router/index.ts.
export const POS_MENUS = [
  {
    seq: "1.1",
    name: "Mesin Kasir",
    desc: "Layar kasir fullscreen untuk scan barang, keranjang, pembayaran, dan cetak struk",
    sub_modul: "KASIR",
    path: "/pos/kasir",
    icon: "ScanLine",
  },
  {
    seq: "2.1",
    name: "Buka Shift",
    desc: "Buka shift kasir dengan modal awal laci",
    sub_modul: "SHIFT",
    path: "/pos/shift/buka",
    icon: "DoorOpen",
  },
  {
    seq: "2.2",
    name: "Tutup Shift",
    desc: "Tutup shift kasir dan rekonsiliasi uang fisik laci (blind closing)",
    sub_modul: "SHIFT",
    path: "/pos/shift/tutup",
    icon: "DoorClosed",
  },
  {
    seq: "3.1",
    name: "Laporan Penjualan Shift Terkini",
    desc: "Rekap transaksi dan rekonsiliasi kas shift yang sudah ditutup",
    sub_modul: "LAPORAN",
    path: "/pos/reports/shift",
    icon: "ReceiptText",
  },
  {
    seq: "3.2",
    name: "Rekap Penjualan Harian Toko",
    desc: "Rekap omzet harian toko dan evaluasi stok untuk pemicu ROP",
    sub_modul: "LAPORAN",
    path: "/pos/reports/harian",
    icon: "CalendarRange",
  },
];

// Kasir tidak mendapat menu 3.2 (hanya Admin/Super Admin).
export const POS_ROLE_GRANTS = {
  KASIR: {
    seqs: ["1.1", "2.1", "2.2", "3.1"],
    perms: { is_read: true, is_create: true, is_update: true, is_delete: false, is_print: true },
  },
  ADMIN: {
    seqs: ["1.1", "2.1", "2.2", "3.1", "3.2"],
    perms: { is_read: true, is_create: true, is_update: true, is_delete: false, is_print: true },
  },
  SUPER_ADMIN: {
    seqs: ["1.1", "2.1", "2.2", "3.1", "3.2"],
    perms: { is_read: true, is_create: true, is_update: true, is_delete: false, is_print: true },
  },
};

// Role yang tidak boleh memiliki akses POS.
export const POS_BLOCKED_ROLES = ["GUDANG"];
