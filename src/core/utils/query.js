import { fail } from "./helpers.js";

/**
 * Normalisasi query list supaya semua endpoint memakai kontrak yang sama:
 * ?page=1&paginate=20&order_by=createdAt&order_type=DESC&search=...&no_pagination=true
 */
export function parseListQuery(
  query = {},
  { defaultLimit = 20, allowedOrder = ["createdAt"], filterFields = [] } = {},
) {
  const page = Number(query.page || 1);
  const limit = Number(query.paginate || defaultLimit);
  const order = query.order_by || "createdAt";
  const direction = String(query.order_type || "DESC").toLowerCase();
  const all = query.no_pagination === "true";

  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    !allowedOrder.includes(order) ||
    !["asc", "desc"].includes(direction)
  ) {
    fail(400, "Parameter daftar tidak valid");
  }

  const filters = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith("filter_column_")) continue;
    const field = key.slice("filter_column_".length);
    if (!filterFields.includes(field)) continue;
    if (value === undefined || value === null || value === "") continue;
    if (value === "true" || value === "false") {
      filters[field] = value === "true";
    } else if (!Number.isNaN(Number(value)) && String(Number(value)) === String(value)) {
      filters[field] = Number(value);
    } else {
      filters[field] = value;
    }
  }

  return {
    page,
    limit,
    order,
    direction,
    all,
    search: String(query.search || "").trim(),
    filters,
  };
}

export function buildSearchWhere(search, fields = []) {
  if (!search || !fields.length) return {};
  return {
    OR: fields.map((field) => ({
      [field]: { contains: search, mode: "insensitive" },
    })),
  };
}

export function buildWhere(query, fields = []) {
  return {
    ...buildSearchWhere(query.search, fields),
    ...(query.filters || {}),
  };
}

export function paginationMeta(total, page, limit, currentRowsCount, all) {
  return {
    total,
    page: all ? 1 : page,
    limit: all ? total : limit,
    totalPages: all ? 1 : Math.ceil(total / limit),
    currentRowsCount,
    next_page: !all && page * limit < total ? page + 1 : null,
    prev_page: !all && page > 1 ? page - 1 : null,
  };
}

export function parseDateRange(query = {}) {
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if (from && Number.isNaN(from.getTime())) fail(400, "Tanggal awal tidak valid");
  if (to && Number.isNaN(to.getTime())) fail(400, "Tanggal akhir tidak valid");
  return { from, to };
}
