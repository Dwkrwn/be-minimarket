import Joi from "joi";
import { fail } from "./helpers.js";

export const validate = (schema, body) => {
  const { error, value } = schema.required().validate(body, {
    abortEarly: true,
    stripUnknown: false,
  });
  if (error) fail(400, error.details[0].message);
  return value;
};

export const uuid = Joi.string().uuid({ version: ["uuidv4", "uuidv5"] });
export const optionalUuid = uuid.allow(null, "");
export const money = Joi.number().min(0).precision(2);
export const qty = Joi.number().integer().min(0);
export const positiveQty = Joi.number().integer().min(1);
export const text = (max = 255) => Joi.string().trim().max(max).allow("", null);
export const requiredText = (max = 255) => Joi.string().trim().max(max).required();
export const isoDate = Joi.date().iso();
