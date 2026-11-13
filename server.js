import "dotenv/config";
import app from "./src/app.js";

const port = Number(process.env.PORT || 5000);
const host = process.env.HOST || "0.0.0.0"; // Listen on all network interfaces for better compatibility

app.listen(port, host, () => {
  console.log(`Backend berjalan di http://localhost:${port}`);
});

