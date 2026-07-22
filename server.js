
const express = require("express");
const path = require("path");
const { getAvailability } = require("./src/providers");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0
}));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "buoycheck" });
});

app.get("/api/availability", async (req, res) => {
  try {
    const provider = String(req.query.provider || "");
    const date = String(req.query.date || "");

    if (!["paradive", "deepstation"].includes(provider)) {
      return res.status(400).json({ ok: false, message: "지원하지 않는 시설입니다." });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, message: "날짜 형식이 올바르지 않습니다." });
    }

    const sessions = await getAvailability(provider, date, req);
    res.json({ ok: true, provider, date, sessions });
  } catch (error) {
    const status = error.statusCode || 501;
    res.status(status).json({
      ok: false,
      code: error.code || "PROVIDER_NOT_CONNECTED",
      message: error.message || "시설 연동이 아직 설정되지 않았습니다."
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`BuoyCheck running on http://localhost:${PORT}`);
});
