"use strict";

const BASE_URL = "https://deepstation.kr";
const DAY_INFO_URL = `${BASE_URL}/rez/ajax.dayinfo.php`;
const RESERVATION_URL = `${BASE_URL}/rez/step2.php`;
const LOGIN_PAGE_URL = `${BASE_URL}/bbs/login.php`;
const LOGIN_CHECK_URL = `${BASE_URL}/bbs/login_check.php`;

const CACHE_TTL_MS = Math.max(30_000, Number(process.env.DEEPSTATION_CACHE_SECONDS || 120) * 1000);
const REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.DEEPSTATION_TIMEOUT_MS || 15_000));
const MAX_REDIRECTS = 8;

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

function credentials() {
  return {
    id: String(process.env.DEEPSTATION_ID || "").trim(),
    password: String(process.env.DEEPSTATION_PASSWORD || "")
  };
}

function canAutoLogin() {
  const { id, password } = credentials();
  return Boolean(id && password);
}

function configuredCookie() {
  return String(process.env.DEEPSTATION_COOKIE || "").trim();
}

function parseCookieHeader(value) {
  const jar = new Map();
  String(value || "").split(";").map(v => v.trim()).filter(Boolean).forEach(part => {
    const index = part.indexOf("=");
    if (index > 0) jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  });
  return jar;
}

function getSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const combined = response.headers.get("set-cookie");
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
}

function mergeCookies(baseCookie, setCookieHeaders) {
  const jar = parseCookieHeader(baseCookie);
  for (const raw of setCookieHeaders || []) {
    const pair = String(raw || "").split(";", 1)[0].trim();
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!value || /^(deleted|null)$/i.test(value)) jar.delete(name);
    else jar.set(name, value);
  }
  return Array.from(jar.entries()).map(([name, value]) => `${name}=${value}`).join("; ");
}

function browserHeaders(cookie = "", extra = {}) {
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ...extra
  };
  if (cookie) headers.Cookie = cookie;
  Object.keys(headers).forEach(key => headers[key] == null && delete headers[key]);
  return headers;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw providerError("딥스테이션 응답 시간이 초과되었습니다.", "DEEPSTATION_TIMEOUT", 504);
    if (error instanceof TypeError && /fetch failed/i.test(error.message || "")) {
      throw providerError("딥스테이션 서버에 연결하지 못했습니다.", "DEEPSTATION_NETWORK_ERROR", 502);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestWithCookieJar(url, options = {}, initialCookie = "") {
  let currentUrl = String(url);
  let method = String(options.method || "GET").toUpperCase();
  let body = options.body;
  let cookie = initialCookie;
  let response;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    response = await fetchWithTimeout(currentUrl, {
      ...options,
      method,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      redirect: "manual",
      headers: browserHeaders(cookie, options.headers || {})
    });

    cookie = mergeCookies(cookie, getSetCookieHeaders(response));
    const location = response.headers.get("location");
    if (!(response.status >= 300 && response.status < 400 && location)) {
      return { response, cookie, finalUrl: currentUrl };
    }

    if (redirectCount === MAX_REDIRECTS) {
      throw providerError("딥스테이션 로그인 이동 횟수가 너무 많습니다.", "DEEPSTATION_TOO_MANY_REDIRECTS", 502);
    }

    currentUrl = new URL(location, currentUrl).toString();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
    }
    await response.arrayBuffer();
  }

  return { response, cookie, finalUrl: currentUrl };
}

function normalizeSessions(payload) {
  const general = payload?.remain?.gen;
  const buoySlots = Array.isArray(payload?.remain_buoys) ? payload.remain_buoys : [];
  if (!Array.isArray(general)) {
    throw providerError("딥스테이션 예약 응답에서 일반권 정보를 찾지 못했습니다.", "DEEPSTATION_BAD_RESPONSE");
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

function looksLikeLoginPage(text, url = "") {
  return /\/bbs\/login\.php/i.test(url) || /회원로그인|name=["']mb_id["']|소셜계정으로 로그인/i.test(String(text || ""));
}

async function performLogin() {
  const { id, password } = credentials();
  if (!id || !password) {
    throw providerError("Render에 DEEPSTATION_ID와 DEEPSTATION_PASSWORD를 설정해 주세요.", "DEEPSTATION_CREDENTIALS_REQUIRED", 503);
  }

  // 새 일반 계정 로그인은 기존 SNS/수동 쿠키와 섞지 않고 깨끗한 세션에서 시작한다.
  let cookie = "";

  // 딥스테이션은 첫 홈페이지 접속 때 PHPSESSID 외에 접속 확인용 쿠키를
  // 함께 발급한다. 로그인 페이지부터 바로 열면 이 쿠키가 빠져
  // ajax.dayinfo.php가 "올바른 경로로 접근하세요"를 반환할 수 있다.
  const home = await requestWithCookieJar(`${BASE_URL}/`, {
    method: "GET",
    headers: {
      Referer: BASE_URL,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1"
    }
  }, cookie);
  cookie = home.cookie;
  await home.response.arrayBuffer();

  const page = await requestWithCookieJar(LOGIN_PAGE_URL, {
    method: "GET",
    headers: { Referer: `${BASE_URL}/` }
  }, cookie);
  cookie = page.cookie;
  await page.response.arrayBuffer();

  const form = new URLSearchParams();
  form.set("mb_id", id);
  form.set("mb_password", password);
  // 실제 브라우저 로그인 요청과 동일하게 홈 주소를 전달한다.
  form.set("url", BASE_URL);

  const login = await requestWithCookieJar(LOGIN_CHECK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: BASE_URL,
      Referer: LOGIN_PAGE_URL
    },
    body: form
  }, cookie);
  cookie = login.cookie;
  const loginText = await login.response.text();

  if (looksLikeLoginPage(loginText, login.finalUrl) || /아이디.*존재|비밀번호.*틀|로그인.*실패|일치하지 않/i.test(loginText)) {
    throw providerError("딥스테이션 로그인에 실패했습니다. 새로 만든 일반 계정의 아이디와 비밀번호를 확인해 주세요.", "DEEPSTATION_LOGIN_FAILED", 503);
  }

  // 실제 브라우저처럼 예약 1단계 → 2단계 순서로 진입해 예약 관련 세션을 만든다.
  const step1 = await requestWithCookieJar(`${BASE_URL}/rez/step1.php`, {
    method: "GET",
    headers: {
      Referer: BASE_URL,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Upgrade-Insecure-Requests": "1"
    }
  }, cookie);
  cookie = step1.cookie;
  const step1Text = await step1.response.text();

  const warmup = await requestWithCookieJar(RESERVATION_URL, {
    method: "GET",
    headers: {
      Referer: `${BASE_URL}/rez/step1.php`,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Upgrade-Insecure-Requests": "1"
    }
  }, cookie);
  cookie = warmup.cookie;
  const warmupText = await warmup.response.text();

  if (looksLikeLoginPage(step1Text, step1.finalUrl) || looksLikeLoginPage(warmupText, warmup.finalUrl)) {
    throw providerError("딥스테이션 로그인 후 예약 페이지 세션을 만들지 못했습니다.", "DEEPSTATION_LOGIN_FAILED", 503);
  }

  console.log(`[DiveSpot] DeepStation reservation warmup: step1=${step1.response.status}, step2=${warmup.response.status}`);

  if (!cookie) {
    throw providerError("딥스테이션에서 로그인 쿠키를 받지 못했습니다.", "DEEPSTATION_LOGIN_FAILED", 503);
  }

  sessionCookie = cookie;
  const cookieNames = Array.from(parseCookieHeader(cookie).keys()).join(", ");
  console.log(`[DiveSpot] DeepStation cookie names: ${cookieNames || "(none)"}`);
  console.log("[DiveSpot] DeepStation automatic login succeeded.");
  return cookie;
}

async function ensureSession(force = false) {
  if (!force && sessionCookie) return sessionCookie;
  if (!force && configuredCookie() && !canAutoLogin()) return configuredCookie();

  if (!canAutoLogin()) {
    if (configuredCookie()) return configuredCookie();
    throw providerError("딥스테이션 로그인 정보가 없습니다.", "DEEPSTATION_LOGIN_REQUIRED", 503);
  }

  if (!loginInFlight) {
    loginInFlight = performLogin().finally(() => { loginInFlight = null; });
  }
  return loginInFlight;
}

async function fetchAvailabilityPayload(date, cookie) {
  const url = new URL(DAY_INFO_URL);
  url.searchParams.set("date", date);
  url.searchParams.set("rez_id", "undefined");
  url.searchParams.set("rtype", "프리다이빙");

  const result = await requestWithCookieJar(url, {
    method: "GET",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: RESERVATION_URL,
      "X-Requested-With": "XMLHttpRequest",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    }
  }, cookie);

  sessionCookie = result.cookie || sessionCookie;
  const text = await result.response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* 아래에서 로그인 페이지 여부를 판별 */ }

  return {
    payload,
    status: result.response.status,
    loggedOut: looksLikeLoginPage(text, result.finalUrl),
    wrongPath: payload?.msg === "올바른 경로로 접근하세요",
    preview: text.replace(/\s+/g, " ").slice(0, 160)
  };
}

async function requestAvailability(date) {
  let cookie = await ensureSession(false);
  let result = await fetchAvailabilityPayload(date, cookie);

  if (result.loggedOut || result.wrongPath || !Array.isArray(result.payload?.remain?.gen)) {
    if (canAutoLogin()) {
      sessionCookie = "";
      cookie = await ensureSession(true);
      result = await fetchAvailabilityPayload(date, cookie);
    }
  }

  if (result.loggedOut) {
    throw providerError("딥스테이션 자동 로그인 후에도 로그인 페이지로 이동했습니다.", "DEEPSTATION_LOGIN_FAILED", 503);
  }
  if (!result.payload) {
    console.error(`[DiveSpot] DeepStation non-JSON response (${result.status}): ${result.preview}`);
    throw providerError("딥스테이션에서 올바른 예약 응답을 받지 못했습니다.", "DEEPSTATION_BAD_RESPONSE", 502);
  }
  if (result.status >= 400 || Number(result.payload?.code) !== 1) {
    throw providerError(result.payload?.message || `딥스테이션 요청에 실패했습니다. (${result.status})`, "DEEPSTATION_REQUEST_FAILED", result.status >= 400 ? result.status : 502);
  }
  if (!Array.isArray(result.payload?.remain?.gen)) {
    const topKeys = Object.keys(result.payload || {}).join(", ");
    const remainKeys = Object.keys(result.payload?.remain || {}).join(", ");
    console.error(`[DiveSpot] DeepStation unexpected JSON. keys=[${topKeys}] remainKeys=[${remainKeys}] preview=${JSON.stringify(result.payload).slice(0, 1000)}`);
    throw providerError("딥스테이션 응답은 받았지만 일반권 목록이 없습니다. Render 로그의 DeepStation unexpected JSON 항목을 확인해 주세요.", "DEEPSTATION_BAD_RESPONSE", 502);
  }
  return normalizeSessions(result.payload);
}

async function getAvailability(date) {
  const cached = cache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.sessions;
  if (inFlight.has(date)) return inFlight.get(date);

  const request = requestAvailability(date).then(sessions => {
    cache.set(date, { expiresAt: Date.now() + CACHE_TTL_MS, sessions });
    return sessions;
  });
  inFlight.set(date, request);
  try { return await request; }
  finally { inFlight.delete(date); }
}

module.exports = { getAvailability, normalizeSessions };
