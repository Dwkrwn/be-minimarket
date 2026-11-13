import Joi from "joi";
import {
  uuid,
  optionalUuid,
  money,
  qty,
  text,
  requiredText,
} from "../../core/utils/validation.js";

export const categorySchema = Joi.object({
  code: text(50),
  name: requiredText(100),
  is_active: Joi.boolean().strict().default(true),
  catatan: text(255),
});

export const unitSchema = Joi.object({
  code: text(50),
  name: requiredText(50),
  is_active: Joi.boolean().strict().default(true),
  catatan: text(255),
});

export const rackSchema = Joi.object({
  code: text(50),
  name: requiredText(100),
  location: Joi.string().valid("WAREHOUSE", "SHELF").default("SHELF"),
  is_active: Joi.boolean().strict().default(true),
  catatan: text(255),
});

const unitDetailSchema = Joi.object({
  unit_name: requiredText(50),
  conversion: Joi.number().integer().min(1).required(),
  is_base: Joi.boolean().strict().default(false),
  is_sell_unit: Joi.boolean().strict().default(false),
});

const rackDetailSchema = Joi.object({
  rack_id: uuid.required(),
  is_default: Joi.boolean().strict().default(false),
});

export const itemSchema = Joi.object({
  barcode: requiredText(100),
  nama_barang: requiredText(150),
  category_id: optionalUuid,
  rack_default_id: optionalUuid,
  base_unit: requiredText(50),
  harga_modal: money.default(0),
  harga_jual: money.default(0),
  min_stock: qty.default(0),
  max_stock: qty.default(0),
  is_active: Joi.boolean().strict().default(true),
  catatan: text(255),
  units: Joi.array().items(unitDetailSchema).unique("unit_name").default([]),
  racks: Joi.array().items(rackDetailSchema).unique("rack_id").default([]),
});
