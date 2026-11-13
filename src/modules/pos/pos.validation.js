import Joi from "joi";
import {
  uuid,
  money,
  positiveQty,
  qty,
  text,
} from "../../core/utils/validation.js";

const paymentMethod = Joi.string().valid("TUNAI", "QRIS", "EDC", "TRANSFER");

const orderItem = Joi.object({
  item_id: uuid.required(),
  qty: positiveQty.required(),
  harga_satuan: money,
  diskon: money.default(0),
});

export const openShiftSchema = Joi.object({
  modal_awal: money.default(0),
  catatan: text(255),
});

export const closeShiftSchema = Joi.object({
  saldo_fisik: money.required(),
  catatan: text(255),
});

export const checkoutSchema = Joi.object({
  items: Joi.array().items(orderItem).min(1).unique("item_id").required(),
  bayar: money.required(),
  metode_bayar: paymentMethod.default("TUNAI"),
  catatan: text(255),
});

export const holdSchema = Joi.object({
  items: Joi.array().items(orderItem).min(1).unique("item_id").required(),
  catatan: text(255),
});

export const voidOrderSchema = Joi.object({
  catatan: Joi.string().trim().max(255).required(),
});

const returnItem = Joi.object({
  item_id: uuid.required(),
  qty: positiveQty.required(),
});

export const posReturnSchema = Joi.object({
  order_id: uuid.required(),
  items: Joi.array().items(returnItem).min(1).unique("item_id").required(),
  catatan: text(255),
});

export const rejectReturnSchema = Joi.object({
  catatan: Joi.string().trim().max(255).required(),
});

const settingItem = Joi.object({
  key: Joi.string()
    .trim()
    .pattern(/^[a-z0-9_.-]{1,100}$/)
    .required(),
  value: Joi.string().allow("", null),
  description: Joi.string().allow("", null),
  is_active: Joi.boolean().strict().default(true),
});

export const settingsSchema = Joi.object({
  settings: Joi.array().items(settingItem).min(1).unique("key").required(),
});

export { qty };
