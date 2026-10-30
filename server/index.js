import "dotenv/config";
import express from "express";
import cors from "cors";
import prisma from "./config/database.js";

const app = express();
const port = Number(process.env.PORT || 5000);

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
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
    console.error(error);

    res.status(503).json({
      message: "Database belum terhubung",
    });
  }
});

app.listen(port, () => {
  console.log(`Backend berjalan di http://localhost:${port}`);
});
