import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ALLOWED_ORIGINS,
  corsOriginCallback,
  isOriginAllowed,
  parseAllowedOrigins,
} from "../core/utils/cors.js";

test("parseAllowedOrigins memakai default pengembangan saat env kosong", () => {
  assert.deepEqual(parseAllowedOrigins(undefined), [...DEFAULT_ALLOWED_ORIGINS]);
  assert.deepEqual(parseAllowedOrigins(""), [...DEFAULT_ALLOWED_ORIGINS]);
  assert.deepEqual(parseAllowedOrigins(" , "), [...DEFAULT_ALLOWED_ORIGINS]);
});

test("parseAllowedOrigins membaca daftar dipisah koma dan membuang spasi", () => {
  assert.deepEqual(
    parseAllowedOrigins("https://toko.example.com, https://admin.example.com"),
    ["https://toko.example.com", "https://admin.example.com"],
  );
});

test("isOriginAllowed menolak origin yang tidak terdaftar (P2 #11)", () => {
  const allowed = ["https://toko.example.com"];

  assert.equal(isOriginAllowed("https://toko.example.com", allowed), true);
  assert.equal(isOriginAllowed("https://jahat.example.com", allowed), false);
  assert.equal(isOriginAllowed("http://localhost:5173", allowed), false);
});

test("isOriginAllowed mengizinkan request non-browser tanpa Origin", () => {
  assert.equal(isOriginAllowed(undefined, ["https://toko.example.com"]), true);
  assert.equal(isOriginAllowed(null, ["https://toko.example.com"]), true);
});

test("isOriginAllowed mendukung wildcard eksplisit dan daftar kosong fail-closed", () => {
  assert.equal(isOriginAllowed("https://apa-saja.example.com", ["*"]), true);
  assert.equal(isOriginAllowed("https://apa-saja.example.com", []), false);
});

test("corsOriginCallback meneruskan keputusan allow/deny ke middleware cors", async () => {
  const callback = corsOriginCallback(["https://toko.example.com"]);

  const decide = (origin) =>
    new Promise((resolve, reject) => {
      callback(origin, (error, allowed) => (error ? reject(error) : resolve(allowed)));
    });

  assert.equal(await decide("https://toko.example.com"), true);
  assert.equal(await decide("https://jahat.example.com"), false);
});
