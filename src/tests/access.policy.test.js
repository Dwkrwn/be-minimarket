import test from "node:test";
import assert from "node:assert/strict";
import { requireRoles } from "../core/middlewares/auth.js";

const kadir = { id: "u-kasir", role: { system_key: "KASIR" } };
const gudang = { id: "u-gudang", role: { system_key: "GUDANG" } };
const admin = { id: "u-admin", role: { system_key: "ADMIN" } };
const superAdmin = { id: "u-super", role: { system_key: "SUPER_ADMIN" } };

function runGuard(guard, user) {
  let statusCode = null;
  let body = null;
  let passed = false;

  const req = { user };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };

  guard(req, res, () => {
    passed = true;
  });

  return { passed, statusCode, body };
}

test("requireRoles mengizinkan role yang terdaftar", () => {
  const guard = requireRoles("GUDANG", "ADMIN", "SUPER_ADMIN");

  assert.equal(runGuard(guard, gudang).passed, true);
  assert.equal(runGuard(guard, admin).passed, true);
  assert.equal(runGuard(guard, superAdmin).passed, true);
});

test("requireRoles menolak KASIR dari area purchasing/finansial (P2 #13)", () => {
  const guard = requireRoles("GUDANG", "ADMIN", "SUPER_ADMIN");
  const result = runGuard(guard, kadir);

  assert.equal(result.passed, false);
  assert.equal(result.statusCode, 403);
  assert.match(result.body.message, /tidak memiliki akses/);
});

test("requireRoles menolak aktor tanpa role", () => {
  const result = runGuard(requireRoles("ADMIN"), { id: "tanpa-role" });
  assert.equal(result.passed, false);
  assert.equal(result.statusCode, 403);
});
