"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { getAvailability } = require("./src/providers");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function loadProvider(provider, date) {
  try {
    const sessions = await getAvailability(provider, date, null);
    return { provider, connected: true, sessions };
  } catch (error) {
    console.error(`[DiveSpot] ${provider} error:`, error);
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

async function handleAvailability(reqUrl, res) {
  const date = String(reqUrl.searchParams.get("date") || "");
  const requestedProvider = String(reqUrl.searchParams.get("provider") || "");

  if (!validDate(date)) {
    sendJson(res, 400, { ok: false, message: "날짜 형식이 올바르지 않습니다." });
    return;
  }

  if (requestedProvider) {
    if (!["paradive", "deepstation"].includes(requestedProvider)) {
      sendJson(res, 400, { ok: false, message: "지원하지 않는 시설입니다." });
      return;
    }

    const result = await loadProvider(requestedProvider, date);
    sendJson(res, result.connected ? 200 : 503, {
      ok: result.connected,
      date,
      provider: result.provider,
      sessions: result.sessions,
      error: result.error
    });
    return;
  }

  const results = await Promise.all([
    loadProvider("paradive", date),
    loadProvider("deepstation", date)
  ]);

  const facilities = Object.fromEntries(results.map(result => [result.provider, {
    connected: result.connected,
    sessions: result.sessions,
    error: result.error
  }]));

  sendJson(res, 200, { ok: true, date, facilities });
}

function safeFilePath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const requested = decoded === "/" ? "/index.html" : decoded;
  const normalized = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);
  return filePath.startsWith(PUBLIC_DIR) ? filePath : null;
}

function sendFile(res, filePath) {
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      const fallback = path.join(PUBLIC_DIR, "index.html");
      fs.readFile(fallback, (fallbackError, data) => {
        if (fallbackError) {
          sendJson(res, 404, { ok: false, message: "페이지를 찾을 수 없습니다." });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": data.length,
          "Cache-Control": "no-store, no-cache, must-revalidate"
        });
        res.end(data);
      });
      return;
    }

    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        sendJson(res, 500, { ok: false, message: "파일을 불러오지 못했습니다." });
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Content-Length": data.length,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0"
      });
      res.end(data);
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, message: "허용되지 않은 요청입니다." });
      return;
    }

    if (reqUrl.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, service: "divespot" });
      return;
    }

    if (reqUrl.pathname === "/api/availability") {
      await handleAvailability(reqUrl, res);
      return;
    }

    const filePath = safeFilePath(reqUrl.pathname);
    if (!filePath) {
      sendJson(res, 400, { ok: false, message: "잘못된 경로입니다." });
      return;
    }
    sendFile(res, filePath);
  } catch (error) {
    console.error("[DiveSpot] server error:", error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, message: "서버 오류가 발생했습니다." });
    else res.end();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`DiveSpot running on http://0.0.0.0:${PORT}`);
});
