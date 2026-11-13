import Joi from "joi";

export const loginSchema = Joi.object({
  username: Joi.string().trim().required(),
  password: Joi.string().max(72).required(),
});
