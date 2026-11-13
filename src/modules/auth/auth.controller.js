import { wrap } from "../../core/utils/helpers.js";
import { loginSchema } from "./auth.validation.js";
import { validate } from "../../core/utils/validation.js";
import {
  loginService,
  logoutService,
  getProfileService,
} from "./auth.service.js";
import { getMenuOptionsService } from "../system/menu.service.js";

export const login = wrap(async (req, res) => {
  const { username, password } = validate(loginSchema, req.body || {});
  const clientIp = req.ip;

  try {
    const result = await loginService({ username, password, clientIp });
    res.json({
      status: "success",
      token: result.token,
      data: { user: result.user },
    });
  } catch (err) {
    if (err.status === 429 && err.retryAfter) {
      res.set("Retry-After", String(err.retryAfter));
    }
    throw err;
  }
});

export const getMe = wrap(async (req, res) => {
  const profile = await getProfileService(req.user);
  res.json({ status: "success", data: profile });
});

export const logout = wrap(async (req, res) => {
  await logoutService(req.session?.id);
  res.json({ status: "success" });
});

export const getMenuOptions = wrap(async (req, res) => {
  const search = req.query.search;
  const data = await getMenuOptionsService(search);
  res.json({ status: "success", data, hasNext: false });
});
