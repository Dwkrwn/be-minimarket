import { Router } from "express";
import { wrap, fail } from "./utils/helpers.js";
import { validate } from "./utils/validation.js";
import {
  parseListQuery,
  buildWhere,
  paginationMeta,
} from "./utils/query.js";

/**
 * Service CRUD generik untuk master data sederhana.
 * Modul transaksi (stok, PO, POS) punya service sendiri karena butuh transaksi atomik.
 */
export function createCrudService({
  model,
  label = "Data",
  allowedOrder = ["createdAt", "updatedAt"],
  searchFields = [],
  filterFields = [],
  include,
  schema,
  beforeCreate,
  beforeUpdate,
  beforeDelete,
}) {
  return {
    async list(query) {
      const parsed = parseListQuery(query, {
        allowedOrder,
        filterFields,
      });
      const where = buildWhere(parsed, searchFields);
      const [total, rows] = await Promise.all([
        model.count({ where }),
        model.findMany({
          where,
          include,
          orderBy: [{ [parsed.order]: parsed.direction }, { id: "asc" }],
          ...(parsed.all
            ? {}
            : { skip: (parsed.page - 1) * parsed.limit, take: parsed.limit }),
        }),
      ]);

      return {
        data: rows,
        pagination: paginationMeta(
          total,
          parsed.page,
          parsed.limit,
          rows.length,
          parsed.all,
        ),
      };
    },

    async getById(id) {
      const row = await model.findUnique({ where: { id }, include });
      if (!row) fail(404, `${label} tidak ditemukan`);
      return row;
    },

    async create(body) {
      const value = schema ? validate(schema, body) : body;
      const data = beforeCreate ? await beforeCreate(value) : value;
      return model.create({ data, include });
    },

    async update(id, body) {
      await this.getById(id);
      const value = schema ? validate(schema, body) : body;
      const data = beforeUpdate ? await beforeUpdate(value, id) : value;
      return model.update({ where: { id }, data, include });
    },

    async remove(id) {
      await this.getById(id);
      if (beforeDelete) await beforeDelete(id);
      await model.delete({ where: { id } });
    },
  };
}

export function createCrudController(service) {
  return {
    list: wrap(async (req, res) => {
      const result = await service.list(req.query);
      res.json({
        status: "success",
        data: result.data,
        pagination: result.pagination,
      });
    }),

    getById: wrap(async (req, res) => {
      res.json({ status: "success", data: await service.getById(req.params.id) });
    }),

    create: wrap(async (req, res) => {
      res.status(201).json({
        status: "success",
        data: await service.create(req.body),
      });
    }),

    update: wrap(async (req, res) => {
      res.json({
        status: "success",
        data: await service.update(req.params.id, req.body),
      });
    }),

    remove: wrap(async (req, res) => {
      await service.remove(req.params.id);
      res.json({ status: "success", message: "Data berhasil dihapus" });
    }),
  };
}

export function createCrudRouter(service, validateId, { writeGuard } = {}) {
  const controller = createCrudController(service);
  const router = Router();
  const guard = writeGuard || ((req, res, next) => next());

  if (validateId) router.param("id", validateId);

  router.get("/", controller.list);
  router.get("/:id", controller.getById);
  router.post("/", guard, controller.create);
  router.put("/:id", guard, controller.update);
  router.delete("/:id", guard, controller.remove);

  return router;
}
