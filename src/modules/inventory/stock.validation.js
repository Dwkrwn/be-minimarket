import Joi from "joi";
import {
  uuid,
  positiveQty,
  qty,
  text,
  isoDate,
} from "../../core/utils/validation.js";

const location = Joi.string().valid("WAREHOUSE", "SHELF");

const mutationItem = Joi.object({
  item_id: uuid.required(),
  qty: positiveQty.required(),
});

const adjustmentItem = Joi.object({
  item_id: uuid.required(),
  qty: positiveQty.required(),
});

const opnameItem = Joi.object({
  item_id: uuid.required(),
  qty_fisik: qty.required(),
  batch_number: text(100),
  expired_date: isoDate.allow(null),
  reason_code: text(30),
  keterangan: text(255),
});

export const mutationSchema = Joi.object({
  from_location: location.default("WAREHOUSE"),
  to_location: location.default("SHELF"),
  catatan: text(255),
  items: Joi.array().items(mutationItem).min(1).unique("item_id").required(),
});

export const adjustmentSchema = Joi.object({
  location: location.default("SHELF"),
  reason_code: Joi.string()
    .valid("EXPIRED", "DAMAGED", "OTHER")
    .required(),
  catatan: text(255),
  items: Joi.array().items(adjustmentItem).min(1).unique("item_id").required(),
});

export const opnameSchema = Joi.object({
  location: location.default("SHELF"),
  catatan: text(255),
  items: Joi.array().items(opnameItem).min(1).unique("item_id").required(),
});

export const opnameRejectSchema = Joi.object({
  catatan: Joi.string().trim().max(255).required(),
});
