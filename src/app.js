import "dotenv/config";
import express from "express";
import cors from "cors";
import prisma from "./config/database.js";
import routes from "./modules/index.js";
import { errorMiddleware } from "./core/middlewares/error.js";
import { corsOriginCallback, parseAllowedOrigins } from "./core/utils/cors.js";

const app = express();

const allowedOrigins = parseAllowedOrigins(process.env.FRONTEND_URL);

app.use(
  cors({
    origin: corsOriginCallback(allowedOrigins),
    credentials: true,
  }),
);

app.use(express.json());

app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      message: "Backend berjalan",
      database: "Terhubung",
    });
  } catch (error) {
    console.error("Database health check error:", error.message);
    res.status(503).json({
      message: "Database belum terhubung",
    });
  }
});

app.use(routes);
app.use(errorMiddleware);

export default app;
