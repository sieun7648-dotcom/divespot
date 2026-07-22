"use strict";

const express = require("express");
const path = require("path");
const { getAvailability } = require("./src/providers");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json());

// 배포 직후 예전 HTML/CSS가 남지 않도록 정적 파일을 항상 재검증합니다.
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: 0,
  etag: true,
  setHeaders(res, filePath) {
    const name = path.basename(filePath);
    if (["index.html", "sw.js", "reset.html"].includes(name)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  }
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
    console.error(`[${provider}]`, error);
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
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`DiveSpot running on http://localhost:${PORT}`);
});
