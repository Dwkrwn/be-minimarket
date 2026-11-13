import Joi from "joi";
import prisma from "../../config/database.js";
import {
  wrap,
  fail,
  hashToken,
  userInclude,
  isManager,
  isSuper,
  hasRole,
} from "../utils/helpers.js";

export const authenticate = wrap(async (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) fail(401, "Sesi tidak valid, silakan login");

  const session = await prisma.auth_session.findUnique({
    where: { token_hash: hashToken(token) },
    include: { user: { include: userInclude } },
  });

  if (
    !session ||
    session.expires_at <= new Date() ||
    !session.user.is_active ||
    !session.user.role.is_active
  ) {
    fail(401, "Sesi berakhir, silakan login");
  }

  req.user = session.user;
  req.session = session;
  next();
});

export const managerOnly = (req, res, next) => {
  if (!isManager(req.user)) {
    return res.status(403).json({
      status: "error",
      message: "Hanya Admin yang dapat mengelola data ini",
    });
  }
  next();
};

export const superOnly = (req, res, next) => {
  if (!isSuper(req.user)) {
    return res.status(403).json({
      status: "error",
      message: "Hanya Super Admin yang dapat mengelola menu",
    });
  }
  next();
};

/**
 * Guard berbasis role sistem. Super Admin selalu lolos.
 * Contoh: requireRoles("ADMIN", "GUDANG")
 */
export const requireRoles =
  (...keys) =>
  (req, res, next) => {
    if (!hasRole(req.user, ...keys)) {
      return res.status(403).json({
        status: "error",
        message: "Role Anda tidak memiliki akses ke fitur ini",
      });
    }
    next();
  };

export const validateGuidParam = (paramName = "id") => (req, res, next, id) => {
  if (Joi.string().guid().validate(id).error) {
    return res.status(400).json({
      status: "error",
      message: `ID ${paramName} tidak valid`,
    });
  }
  next();
};
