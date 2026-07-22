"use strict";

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
  res.json({ ok: true, service: "divespot" });
});

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function loadProvider(provider, date, req) {
  try {
    const sessions = await getAvailability(provider, date, req);
    return { provider, connected: true, sessions };
  } catch (error) {
    return {
      provider,
      connected: false,
      sessions: [],
      error: {
        code: error.code || "PROVIDER_NOT_CONNECTED",
        message: error.message || "시설 연동이 설정되지 않았습니다."
      }
    };
  }
}

app.get("/api/availability", async (req, res) => {
  const date = String(req.query.date || "");
  const requestedProvider = String(req.query.provider || "");

  if (!validDate(date)) {
    return res.status(400).json({ ok: false, message: "날짜 형식이 올바르지 않습니다." });
  }

  if (requestedProvider) {
    if (!["paradive", "deepstation"].includes(requestedProvider)) {
      return res.status(400).json({ ok: false, message: "지원하지 않는 시설입니다." });
    }

    const result = await loadProvider(requestedProvider, date, req);
    return res.status(result.connected ? 200 : 503).json({
      ok: result.connected,
      date,
      provider: result.provider,
      sessions: result.sessions,
      error: result.error
    });
  }

  const results = await Promise.all([
    loadProvider("paradive", date, req),
    loadProvider("deepstation", date, req)
  ]);

  const facilities = Object.fromEntries(results.map(result => [result.provider, {
    connected: result.connected,
    sessions: result.sessions,
    error: result.error
  }]));

  return res.json({ ok: true, date, facilities });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`DiveSpot running on http://localhost:${PORT}`);
});
