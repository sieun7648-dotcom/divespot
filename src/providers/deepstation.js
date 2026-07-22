"use strict";

const BASE_URL = "https://deepstation.kr";
const DAY_INFO_URL = `${BASE_URL}/rez/ajax.dayinfo.php`;
const RESERVATION_URL = `${BASE_URL}/rez/step2.php`;
const CACHE_TTL_MS = Math.max(30_000, Number(process.env.DEEPSTATION_CACHE_SECONDS || 120) * 1000);
const cache = new Map();

function providerError(message, code, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getCookie() {
  return String(process.env.DEEPSTATION_COOKIE || "").trim();
}

function buildHeaders() {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    Referer: RESERVATION_URL,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest"
  };

  const cookie = getCookie();
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function normalizeSessions(payload) {
  const general = payload?.remain?.gen;
  const buoySlots = Array.isArray(payload?.remain_buoys) ? payload.remain_buoys : [];

  if (!Array.isArray(general)) {
    throw providerError(
      "딥스테이션 예약 응답에서 일반권 정보를 찾지 못했습니다.",
      "DEEPSTATION_BAD_RESPONSE"
    );
  }

  return general.map((session, index) => {
    const matchingBuoys = buoySlots
      .filter(slot => String(slot.stime || "") >= String(session.stime || "") && String(slot.etime || "") <= String(session.etime || ""))
      .sort((a, b) => String(a.stime || "").localeCompare(String(b.stime || "")));

    const frontSlot = matchingBuoys[0] || buoySlots[index * 2];
    const backSlot = matchingBuoys[1] || buoySlots[index * 2 + 1];

    return {
      part: `${index + 1}부`,
      time: `${session.stime || ""} ~ ${session.etime || ""}`.trim(),
      people: asNumber(session.remain),
      front: asNumber(frontSlot?.remain_buoys),
      back: asNumber(backSlot?.remain_buoys)
    };
  });
}

async function requestAvailability(date) {
  const url = new URL(DAY_INFO_URL);
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
      headers: buildHeaders()
    });

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      const preview = text.replace(/\s+/g, " ").slice(0, 180);
      console.error(`[DiveSpot] DeepStation non-JSON response (${response.status}): ${preview}`);

      if (!getCookie()) {
        throw providerError(
          "딥스테이션 로그인 쿠키가 필요합니다. Render 환경변수 DEEPSTATION_COOKIE를 설정해 주세요.",
          "DEEPSTATION_LOGIN_REQUIRED",
          503
        );
      }

      throw providerError(
        "딥스테이션 로그인 세션이 만료되었거나 접근이 차단되었습니다. DEEPSTATION_COOKIE를 다시 설정해 주세요.",
        "DEEPSTATION_SESSION_EXPIRED",
        503
      );
    }

    if (!response.ok || Number(payload?.code) !== 1) {
      throw providerError(
        payload?.message || `딥스테이션 요청에 실패했습니다. (${response.status})`,
        "DEEPSTATION_REQUEST_FAILED",
        response.status >= 400 ? response.status : 502
      );
    }

    return normalizeSessions(payload);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw providerError("딥스테이션 응답 시간이 초과되었습니다.", "DEEPSTATION_TIMEOUT", 504);
    }
    if (error instanceof TypeError && /fetch failed/i.test(error.message || "")) {
      throw providerError("딥스테이션 서버에 연결하지 못했습니다.", "DEEPSTATION_NETWORK_ERROR", 502);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getAvailability(date) {
  const cached = cache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.sessions;

  const sessions = await requestAvailability(date);
  cache.set(date, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    sessions
  });
  return sessions;
}

module.exports = { getAvailability, normalizeSessions };
