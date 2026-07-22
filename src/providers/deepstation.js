"use strict";

const BASE_URL = "https://deepstation.kr";
const CHECK_URL = `${BASE_URL}/rez/ajax.dayinfo.php`;
const RESERVATION_URL = `${BASE_URL}/rez/step2.php`;
const CACHE_TTL_MS = Math.max(30_000, Number(process.env.DEEPSTATION_CACHE_SECONDS || 300) * 1000);

const cache = new Map();

function providerError(message, code, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function requestDayInfo(date) {
  const url = new URL(CHECK_URL);
  url.searchParams.set("date", date);
  url.searchParams.set("rez_id", "undefined");
  url.searchParams.set("rtype", "프리다이빙");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        Referer: RESERVATION_URL,
        "User-Agent": "Mozilla/5.0 (compatible; DiveSpot/1.0)",
        "X-Requested-With": "XMLHttpRequest"
      }
    });

    const text = await response.text();
    let json;

    try {
      json = JSON.parse(text);
    } catch {
      throw providerError(
        "딥스테이션 응답 형식을 확인할 수 없습니다.",
        "DEEPSTATION_BAD_RESPONSE",
        502
      );
    }

    if (!response.ok || json?.code !== 1) {
      throw providerError(
        json?.message || `딥스테이션 요청에 실패했습니다. (${response.status})`,
        "DEEPSTATION_REQUEST_FAILED",
        502
      );
    }

    return json;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw providerError("딥스테이션 응답 시간이 초과되었습니다.", "DEEPSTATION_TIMEOUT", 504);
    }
    if (error instanceof TypeError) {
      throw providerError("딥스테이션 서버에 연결하지 못했습니다.", "DEEPSTATION_CONNECTION_FAILED", 502);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSessions(payload) {
  const peopleSessions = Array.isArray(payload?.remain?.gen) ? payload.remain.gen : [];
  const buoySessions = Array.isArray(payload?.remain_buoys) ? payload.remain_buoys : [];

  return peopleSessions.map((session, index) => {
    const frontBuoy = buoySessions[index * 2];
    const backBuoy = buoySessions[index * 2 + 1];

    return {
      part: `${index + 1}부`,
      time: `${session.stime || ""} ~ ${session.etime || ""}`.trim(),
      people: toNumber(session.remain),
      front: frontBuoy ? toNumber(frontBuoy.remain_buoys) : null,
      back: backBuoy ? toNumber(backBuoy.remain_buoys) : null
    };
  });
}

async function getAvailability(date) {
  const cached = cache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.sessions;

  const payload = await requestDayInfo(date);
  const sessions = normalizeSessions(payload);

  if (!sessions.length) {
    throw providerError(
      "딥스테이션 예약 현황 데이터가 없습니다.",
      "DEEPSTATION_NO_DATA",
      502
    );
  }

  cache.set(date, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    sessions
  });

  return sessions;
}

module.exports = { getAvailability };
