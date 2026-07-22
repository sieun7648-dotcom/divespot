"use strict";

const BASE_URL = "https://deepstation.kr";
const DAY_INFO_URL = `${BASE_URL}/rez/ajax.dayinfo.php`;
const RESERVATION_URL = `${BASE_URL}/rez/step2.php`;
const LOGIN_PAGE_URL = `${BASE_URL}/bbs/login.php`;
const LOGIN_CHECK_URL = `${BASE_URL}/bbs/login_check.php`;

const CACHE_TTL_MS = Math.max(30_000, Number(process.env.DEEPSTATION_CACHE_SECONDS || 120) * 1000);
const REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.DEEPSTATION_TIMEOUT_MS || 12_000));

const cache = new Map();
const inFlight = new Map();
let sessionCookie = "";
let loginInFlight = null;

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

function getConfiguredCookie() {
  return String(process.env.DEEPSTATION_COOKIE || "").trim();
}

function getCredentials() {
  return {
    id: String(process.env.DEEPSTATION_ID || "").trim(),
    password: String(process.env.DEEPSTATION_PASSWORD || "")
  };
}

function canAutoLogin() {
  const { id, password } = getCredentials();
  return Boolean(id && password);
}

function parseCookieHeader(cookieHeader) {
  const jar = new Map();
  String(cookieHeader || "")
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .forEach(part => {
      const index = part.indexOf("=");
      if (index <= 0) return;
      jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
    });
  return jar;
}

function getSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const combined = response.headers.get("set-cookie");
  if (!combined) return [];

  // Expires 속성 안의 쉼표는 쿠키 구분자가 아니므로, 새 쿠키 이름 앞의 쉼표만 분리한다.
  return combined.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
}

function mergeCookies(baseCookie, setCookieHeaders) {
  const jar = parseCookieHeader(baseCookie);

  for (const rawHeader of setCookieHeaders || []) {
    const firstPart = String(rawHeader || "").split(";", 1)[0].trim();
    const index = firstPart.indexOf("=");
    if (index <= 0) continue;

    const name = firstPart.slice(0, index).trim();
    const value = firstPart.slice(index + 1).trim();
    if (!value || /^(deleted|null)$/i.test(value)) jar.delete(name);
    else jar.set(name, value);
  }

  return Array.from(jar.entries()).map(([name, value]) => `${name}=${value}`).join("; ");
}

function activeCookie() {
  return sessionCookie || getConfiguredCookie();
}

function buildHeaders(cookie = activeCookie(), extra = {}) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    Referer: RESERVATION_URL,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    ...extra
  };

  if (cookie) headers.Cookie = cookie;
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || value === null) delete headers[name];
  }
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

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
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

function payloadLooksLoggedOut(payload) {
  if (!payload || typeof payload !== "object") return true;
  if (Array.isArray(payload?.remain?.gen)) return false;

  const message = String(payload?.message || payload?.msg || "");
  return /로그인|login|회원|세션|권한|인증/i.test(message) || !payload?.remain;
}

async function performLogin() {
  const { id, password } = getCredentials();
  if (!id || !password) {
    throw providerError(
      "딥스테이션 자동 로그인을 위해 Render 환경변수 DEEPSTATION_ID와 DEEPSTATION_PASSWORD를 설정해 주세요.",
      "DEEPSTATION_CREDENTIALS_REQUIRED",
      503
    );
  }

  let cookie = getConfiguredCookie();

  // 로그인 페이지에서 PHP 세션 및 사이트 기본 쿠키를 먼저 발급받는다.
  const loginPageResponse = await fetchWithTimeout(LOGIN_PAGE_URL, {
    method: "GET",
    redirect: "manual",
    headers: buildHeaders(cookie, {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: BASE_URL,
      "X-Requested-With": undefined
    })
  });
  cookie = mergeCookies(cookie, getSetCookieHeaders(loginPageResponse));
  await loginPageResponse.arrayBuffer();

  const body = new URLSearchParams({
    mb_id: id,
    mb_password: password,
    url: RESERVATION_URL
  });

  const loginResponse = await fetchWithTimeout(LOGIN_CHECK_URL, {
    method: "POST",
    redirect: "manual",
    headers: buildHeaders(cookie, {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: BASE_URL,
      Referer: LOGIN_PAGE_URL,
      "X-Requested-With": undefined
    }),
    body
  });

  cookie = mergeCookies(cookie, getSetCookieHeaders(loginResponse));
  const loginText = await loginResponse.text();
  const location = String(loginResponse.headers.get("location") || "");

  const explicitFailure = /비밀번호|아이디|로그인.*실패|일치하지|alert\s*\(/i.test(loginText) &&
    !/location\.href|document\.location/i.test(loginText);
  const redirectedBackToLogin = /\/bbs\/login\.php/i.test(location);

  if (!cookie || explicitFailure || redirectedBackToLogin || loginResponse.status >= 500) {
    throw providerError(
      "딥스테이션 자동 로그인에 실패했습니다. Render의 아이디와 비밀번호를 확인해 주세요.",
      "DEEPSTATION_LOGIN_FAILED",
      503
    );
  }

  sessionCookie = cookie;
  return cookie;
}

async function ensureLoggedIn(force = false) {
  if (!force && activeCookie()) return activeCookie();

  if (!canAutoLogin()) {
    if (activeCookie()) return activeCookie();
    throw providerError(
      "딥스테이션 로그인 정보가 없습니다. Render에 DEEPSTATION_ID와 DEEPSTATION_PASSWORD를 설정해 주세요.",
      "DEEPSTATION_LOGIN_REQUIRED",
      503
    );
  }

  if (!loginInFlight) {
    loginInFlight = performLogin().finally(() => {
      loginInFlight = null;
    });
  }
  return loginInFlight;
}

async function fetchAvailabilityPayload(date, cookie) {
  const url = new URL(DAY_INFO_URL);
  url.searchParams.set("date", date);
  url.searchParams.set("rez_id", "undefined");
  url.searchParams.set("rtype", "프리다이빙");

  const response = await fetchWithTimeout(url, {
    method: "GET",
    redirect: "manual",
    headers: buildHeaders(cookie)
  });

  // 로그인 페이지로 돌려보내면 세션 만료로 판단한다.
  if (response.status >= 300 && response.status < 400) {
    return { loggedOut: true, payload: null, status: response.status };
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 180);
    console.error(`[DiveSpot] DeepStation non-JSON response (${response.status}): ${preview}`);
    return { loggedOut: /login|로그인|회원로그인|mb_id/i.test(text), payload: null, status: response.status };
  }

  return {
    loggedOut: payloadLooksLoggedOut(payload),
    payload,
    status: response.status
  };
}

async function requestAvailability(date) {
  let cookie = await ensureLoggedIn(false);
  let result = await fetchAvailabilityPayload(date, cookie);

  // 수동 쿠키가 만료됐거나 서버 세션이 끊긴 경우 자동 로그인 후 딱 한 번 재조회한다.
  if (result.loggedOut || !Array.isArray(result.payload?.remain?.gen)) {
    if (canAutoLogin()) {
      sessionCookie = "";
      cookie = await ensureLoggedIn(true);
      result = await fetchAvailabilityPayload(date, cookie);
    }
  }

  const { payload, status } = result;

  if (result.loggedOut) {
    throw providerError(
      canAutoLogin()
        ? "딥스테이션 자동 로그인 후에도 세션을 확인하지 못했습니다. 계정 정보를 확인해 주세요."
        : "딥스테이션 로그인 세션이 만료되었습니다. Render에 자동 로그인 정보를 설정해 주세요.",
      canAutoLogin() ? "DEEPSTATION_LOGIN_FAILED" : "DEEPSTATION_SESSION_EXPIRED",
      503
    );
  }

  if (!payload) {
    throw providerError(
      "딥스테이션에서 올바른 예약 응답을 받지 못했습니다.",
      "DEEPSTATION_BAD_RESPONSE",
      502
    );
  }

  if (status >= 400 || Number(payload?.code) !== 1) {
    throw providerError(
      payload?.message || `딥스테이션 요청에 실패했습니다. (${status})`,
      "DEEPSTATION_REQUEST_FAILED",
      status >= 400 ? status : 502
    );
  }

  return normalizeSessions(payload);
}

async function getAvailability(date) {
  const cached = cache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.sessions;

  const pending = inFlight.get(date);
  if (pending) return pending;

  const request = (async () => {
    const sessions = await requestAvailability(date);
    cache.set(date, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      sessions
    });
    return sessions;
  })();

  inFlight.set(date, request);
  try {
    return await request;
  } finally {
    inFlight.delete(date);
  }
}

module.exports = {
  getAvailability,
  normalizeSessions,
  // 아래 함수들은 로컬 테스트용이며 계정 정보는 외부로 노출하지 않는다.
  _test: { mergeCookies, payloadLooksLoggedOut }
};
