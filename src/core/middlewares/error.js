const PRISMA_STATUS = {
  P2000: 400,
  P2002: 409,
  P2003: 409,
  P2011: 400,
  P2014: 409,
  P2025: 404,
};

export const errorMiddleware = (error, req, res, next) => {
  const status = error.status || PRISMA_STATUS[error.code] || 500;

  if (status >= 500) {
    console.error("Server error:", error.code || error.name, error.message);
  }

  const message =
    error.status && status < 500
      ? error.type === "entity.parse.failed"
        ? "JSON tidak valid"
        : error.message
      : status === 404
        ? "Data tidak ditemukan"
        : status === 409
          ? "Data masih digunakan atau sudah ada"
          : "Gagal memproses permintaan";

  res.status(status).json({
    status: "error",
    message,
  });
};
