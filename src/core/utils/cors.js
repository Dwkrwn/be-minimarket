// =============================================================================
// CORS - PEMBATAS ORIGIN YANG DIIZINKAN
// Logika murni agar kebijakan origin dapat diuji tanpa menyalakan server.
// =============================================================================

export const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

/**
 * Membaca daftar origin dari environment (dipisah koma).
 * Bila kosong, memakai daftar default pengembangan.
 */
export function parseAllowedOrigins(value) {
  if (value === undefined || value === null) return [...DEFAULT_ALLOWED_ORIGINS];

  const origins = String(value)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : [...DEFAULT_ALLOWED_ORIGINS];
}

/**
 * Origin tanpa header (curl, server-to-server, health check) tetap diizinkan
 * karena bukan permintaan browser lintas-origin.
 */
export function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) return false;
  if (allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(origin);
}

/**
 * Callback untuk opsi `origin` pada middleware cors.
 * Origin yang tidak terdaftar ditolak (tanpa header Access-Control-Allow-Origin).
 */
export function corsOriginCallback(allowedOrigins) {
  return (origin, callback) => {
    callback(null, isOriginAllowed(origin, allowedOrigins));
  };
}
