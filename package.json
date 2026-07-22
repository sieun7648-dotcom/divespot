"use strict";

const BASE_URL = "https://paradive.co.kr";
const CHECK_URL = `${BASE_URL}/service/pc/ajax/ajax.reservation.bui.select.php`;
const RESERVATION_URL = `${BASE_URL}/service/pc/page/reservation02.php`;

const CACHE_TTL_MS = Math.max(30_000, Number(process.env.PARADIVE_CACHE_SECONDS || 300) * 1000);
const MAX_PEOPLE = Math.max(2, Number(process.env.PARADIVE_MAX_PEOPLE || 40));
const EXERCISE_SELECT = String(process.env.PARADIVE_EXERCISE_SELECT || "2");
const USE_TIME = String(process.env.PARADIVE_USE_TIME || "2");

const SESSION_TIMES = [
  "08:00 ~ 11:00",
  "11:00 ~ 14:00",
  "14:00 ~ 17:00",
  "17:00 ~ 20:00",
  "20:00 ~ 23:00"
];

const cache = new Map();

function providerError(message, code, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function getCookie() {
  const cookie = String(process.env.PARADIVE_COOKIE || "").trim();
  if (!cookie) {
    throw providerError(
      "파라다이브 로그인 연결이 필요합니다. Render 환경변수 PARADIVE_COOKIE를 설정해 주세요.",
      "PARADIVE_LOGIN_REQUIRED",
      503
    );
  }
  return cookie;
}

async function postForm(data) {
  const cookie = getCookie();
  const body = new URLSearchParams(data);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(CHECK_URL, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: cookie,
        Origin: BASE_URL,
        Referer: RESERVATION_URL,
        "User-Agent": "Mozilla/5.0 (compatible; DiveSpot/1.0)",
        "X-Requested-With": "XMLHttpRequest"
      },
      body
    });

    if (response.status >= 300 && response.status < 400) {
      throw providerError(
        "파라다이브 로그인 세션이 만료되었습니다.",
        "PARADIVE_SESSION_EXPIRED",
        503
      );
    }

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      const loginPage = /login|로그인|PHPSESSID/i.test(text);
      throw providerError(
        loginPage
          ? "파라다이브 로그인 세션이 만료되었습니다."
          : "파라다이브 응답 형식을 확인할 수 없습니다.",
        loginPage ? "PARADIVE_SESSION_EXPIRED" : "PARADIVE_BAD_RESPONSE",
        503
      );
    }

    if (!response.ok) {
      throw providerError(
        json?.msg || `파라다이브 요청에 실패했습니다. (${response.status})`,
        "PARADIVE_REQUEST_FAILED",
        502
      );
    }

    return json;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw providerError("파라다이브 응답 시간이 초과되었습니다.", "PARADIVE_TIMEOUT", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function canReserve(date, step, count) {
  const json = await postForm({
    op: "stock",
    od_date: date,
    od_step: String(step),
    od_exercise_select: EXERCISE_SELECT,
    od_cnt: String(count),
    us_time: USE_TIME
  });

  if (json?.status === "success") return true;
  if (json?.status === "fail") return false;

  throw providerError(
    json?.msg || "파라다이브 예약 가능 여부를 판단할 수 없습니다.",
    "PARADIVE_UNKNOWN_STATUS",
    502
  );
}

async function findMaximumPeople(date, step) {
  // 파라다이브는 현재 최소 2명부터 예약 가능하도록 검증한다.
  if (!(await canReserve(date, step, 2))) return 0;

  let low = 2;
  let high = MAX_PEOPLE;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (await canReserve(date, step, mid)) low = mid;
    else high = mid - 1;
  }

  return low;
}

async function checkBuoy(date, step, buoyValue) {
  const json = await postForm({
    op: "select",
    od_date: date,
    od_step: String(step),
    od_exercise_select: EXERCISE_SELECT,
    od_exercise_bui_select: String(buoyValue)
  });

  if (json?.status === "success") return 1;
  if (json?.status === "fail") return 0;
  return null;
}

async function getSession(date, step) {
  const [people, front, back] = await Promise.all([
    findMaximumPeople(date, step),
    checkBuoy(date, step, 1),
    checkBuoy(date, step, 2)
  ]);

  return {
    part: `${step}부`,
    time: SESSION_TIMES[step - 1] || "",
    people,
    front,
    back
  };
}

async function getAvailability(date) {
  const cached = cache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.sessions;

  // 동시에 너무 많은 검증 요청이 발생하지 않도록 부별로 순차 조회한다.
  const sessions = [];
  for (let step = 1; step <= 5; step += 1) {
    sessions.push(await getSession(date, step));
  }

  cache.set(date, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    sessions
  });

  return sessions;
}

module.exports = { getAvailability };
