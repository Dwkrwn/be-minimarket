import Joi from "joi";
import { uuid, text, optionalUuid } from "../../core/utils/validation.js";

const str = Joi.string().trim().max(100);

const password = Joi.string()
  .min(8)
  .max(72)
  .custom((value, helpers) =>
    Buffer.byteLength(value) > 72
      ? helpers.error("string.max", { limit: 72 })
      : value,
  );

export const userSchema = Joi.object({
  name: str.required(),
  username: str
    .pattern(/^[a-zA-Z0-9_.-]+$/)
    .required(),
  password,
  role_id: uuid.required(),
  is_active: Joi.boolean().strict().required(),
  catatan: Joi.string().allow("", null),
});

export const permissionSchema = Joi.object({
  m_menu_id: uuid.required(),
  ...Object.fromEntries(
    ["read", "create", "update", "delete", "print"].map((action) => [
      `is_${action}`,
      Joi.boolean().strict().default(false),
    ]),
  ),
});

export const roleSchema = Joi.object({
  nama_role: str.required(),
  kode_role: str.allow("", null),
  catatan: Joi.string().allow("", null),
  is_active: Joi.boolean().strict().required(),
  m_role_d: Joi.array().items(permissionSchema).unique("m_menu_id").default([]),
});

export const menuSchema = Joi.object({
  name: str.required(),
  modul: str.required(),
  path: str.required(),
  sub_modul: str.allow("", null),
  icon: str.allow("", null),
  desc: Joi.string().allow("", null),
  seq: str.pattern(/^\d+(\.\d+)*$/).allow("", null),
  is_active: Joi.boolean().strict(),
});

export { optionalUuid };
