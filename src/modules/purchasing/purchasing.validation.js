import Joi from "joi";
import {
  uuid,
  money,
  positiveQty,
  qty,
  text,
  requiredText,
  isoDate,
} from "../../core/utils/validation.js";

export const supplierSchema = Joi.object({
  kode_supplier: requiredText(50),
  nama_supplier: requiredText(150),
  kontak_sales: text(100),
  no_telp: text(50),
  no_wa: text(50),
  alamat: text(255),
  term_of_payment: Joi.number().integer().min(0).default(0),
  is_active: Joi.boolean().strict().default(true),
  catatan: text(255),
});

export const supplierPriceSchema = Joi.object({
  supplier_id: uuid.required(),
  item_id: uuid.required(),
  harga_beli: money.required(),
  is_active: Joi.boolean().strict().default(true),
});

const poItem = Joi.object({
  item_id: uuid.required(),
  qty: positiveQty.required(),
  harga_satuan: money.required(),
});

export const purchaseOrderSchema = Joi.object({
  supplier_id: uuid.required(),
  tgl_dikirim: isoDate.allow(null),
  catatan: text(255),
  items: Joi.array().items(poItem).min(1).unique("item_id").required(),
});

const grItem = Joi.object({
  item_id: uuid.required(),
  qty_diterima: qty.required(),
  qty_ditolak: qty.default(0),
  batch_number: text(100),
  expired_date: isoDate.allow(null),
  harga_satuan: money.required(),
});

export const goodsReceiptSchema = Joi.object({
  po_id: uuid.required(),
  catatan: text(255),
  items: Joi.array().items(grItem).min(1).unique("item_id").required(),
});

const returnItem = Joi.object({
  item_id: uuid.required(),
  qty: positiveQty.required(),
});

export const purchaseReturnSchema = Joi.object({
  po_id: uuid.required(),
  reason_code: Joi.string().valid("EXPIRED", "DAMAGED", "OTHER").required(),
  catatan: text(255),
  items: Joi.array().items(returnItem).min(1).unique("item_id").required(),
});

export const purchaseInvoiceSchema = Joi.object({
  po_id: uuid.required(),
  no_invoice: requiredText(50),
  tgl_invoice: isoDate,
  tgl_jatuh_tempo: isoDate,
  total_tagihan: money.required(),
  catatan: text(255),
  force: Joi.boolean().strict().default(false),
});

export const invoiceStatusSchema = Joi.object({
  status: Joi.string().valid("UNPAID", "PARTIAL", "PAID").required(),
});
