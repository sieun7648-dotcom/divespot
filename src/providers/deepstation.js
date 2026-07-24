"use strict";

const { chromium } = require("playwright");

const BASE_URL = "https://deepstation.kr";
const LOGIN_PAGE_URL = `${BASE_URL}/bbs/login.php`;
const STEP1_URL = `${BASE_URL}/rez/step1.php`;
const RESERVATION_URL = `${BASE_URL}/rez/step2.php`;

function secondsFromEnv(name, fallback, minimum) {
  const value = Number(process.env[name]);
  const seconds = Number.isFinite(value) ? value : fallback;
  return Math.max(minimum, seconds) * 1000;
}

const CACHE_TTL_MS = secondsFromEnv("DEEPSTATION_CACHE_SECONDS", 300, 30);
// 실제 로그아웃 응답은 자동 감지하므로 정상 세션을 짧은 주기로 버리지 않는다.
const SESSION_TTL_MS = secondsFromEnv("DEEPSTATION_SESSION_SECONDS", 6 * 60 * 60, 6 * 60 * 60);
const BROWSER_TIMEOUT_MS = secondsFromEnv("DEEPSTATION_TIMEOUT_SECONDS", 25, 5);
const ENTRY_TIMEOUT_MS = secondsFromEnv("DEEPSTATION_ENTRY_TIMEOUT_SECONDS", 8, 3);
const USER_CHECK_TIMEOUT_MS = secondsFromEnv("DEEPSTATION_USER_CHECK_TIMEOUT_SECONDS", 25, 15);
const DIAGNOSTIC_TTL_MS = 60_000;

const cache = new Map();
const inFlight = new Map();

let browser = null;
let browserLaunchInFlight = null;
let context = null;
let reservationPage = null;
let authenticatedAt = 0;
let operationTail = Promise.resolve();
let diagnosticCache = null;
let diagnosticInFlight = null;

function providerError(message, code, statusCode = 502, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function redactSensitiveText(value) {
  let text = String(value ?? "");
  const sensitiveKey = "password|passwd|pwd|mb_password|email|mb_id|user_id|username|phone|tel|mobile|token|authorization|cookie|session(?:id)?|phpsessid";

  text = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL_MASKED]")
    .replace(/(?:\+82[-.\s]?|0)(?:10|11|16|17|18|19)[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[PHONE_MASKED]")
    .replace(/0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4}/g, "[PHONE_MASKED]")
    .replace(new RegExp(`([?&](?:${sensitiveKey})=)[^&#\\s]*`, "gi"), "$1[MASKED]")
    .replace(new RegExp(`(["'](?:${sensitiveKey})["']\\s*:\\s*["'])[^"']*(["'])`, "gi"), "$1[MASKED]$2")
    .replace(/\b(PHPSESSID|connect\.sid|sessionid|authorization|cookie)\s*=\s*[^;\s,]+/gi, "$1=[MASKED]")
    .replace(/<input\b[^>]*>/gi, tag => {
      const sensitiveInput = new RegExp(`(?:name|id)\\s*=\\s*["']?(?:${sensitiveKey})`, "i");
      if (!sensitiveInput.test(tag)) return tag;
      return tag.replace(/(\bvalue\s*=\s*["'])[^"']*(["'])/i, "$1[MASKED]$2");
    });

  return text;
}

function errorDetails(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || undefined,
    message: redactSensitiveText(error?.message || String(error))
  };
}

function responsePreview(text, limit = 500) {
  const normalized = String(text || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return redactSensitiveText(normalized).slice(0, limit);
}

function logPlaywrightFailure(stage, error) {
  console.error(
    `[DiveSpot][DeepStation][PLAYWRIGHT_FAILURE] stage=${stage}`,
    errorDetails(error)
  );
}

function logLoginFailure(stage, error, pageUrl = "") {
  console.error(
    `[DiveSpot][DeepStation][LOGIN_FAILURE] stage=${stage} url=${redactSensitiveText(pageUrl || "(unknown)")}`,
    errorDetails(error)
  );
}

function runBrowserOperation(task) {
  const run = operationTail.then(task, task);
  operationTail = run.catch(() => undefined);
  return run;
}

function credentials() {
  return {
    id: String(process.env.DEEPSTATION_ID || "").trim(),
    password: String(process.env.DEEPSTATION_PASSWORD || "")
  };
}

function buildDayInfoPath(date) {
  const query = new URLSearchParams();
  query.set("date", date);
  query.set("rez_id", "undefined");
  query.set("rtype", "프리다이빙");
  return `/rez/ajax.dayinfo.php?${query.toString()}`;
}

function normalizeSessions(payload) {
  const general = payload?.remain?.gen;
  const buoySlots = Array.isArray(payload?.remain_buoys) ? payload.remain_buoys : [];

  if (!Array.isArray(general)) {
    throw providerError(
      "딥스테이션 응답에서 remain.gen 잔여석 정보를 찾지 못했습니다.",
      "DEEPSTATION_BAD_RESPONSE"
    );
  }

  return general.map((session, index) => {
    const matchingBuoys = buoySlots
      .filter(slot => (
        String(slot?.stime || "") >= String(session?.stime || "")
        && String(slot?.etime || "") <= String(session?.etime || "")
      ))
      .sort((a, b) => String(a?.stime || "").localeCompare(String(b?.stime || "")));

    const frontSlot = matchingBuoys[0] || buoySlots[index * 2];
    const backSlot = matchingBuoys[1] || buoySlots[index * 2 + 1];

    return {
      part: `${index + 1}부`,
      time: `${session?.stime || ""} ~ ${session?.etime || ""}`.trim(),
      people: asNumber(session?.remain),
      front: asNumber(frontSlot?.remain_buoys),
      back: asNumber(backSlot?.remain_buoys)
    };
  });
}

function clearBrowserReferences(disconnectedBrowser) {
  if (disconnectedBrowser && browser !== disconnectedBrowser) return;
  browser = null;
  browserLaunchInFlight = null;
  context = null;
  reservationPage = null;
  authenticatedAt = 0;
  diagnosticCache = null;
}

async function ensureBrowser() {
  if (browser?.isConnected()) return browser;
  if (browserLaunchInFlight) return browserLaunchInFlight;

  browserLaunchInFlight = (async () => {
    try {
      console.log("[DiveSpot][DeepStation][PLAYWRIGHT] Chromium launch started");
      const launchedBrowser = await chromium.launch({
        headless: true,
        timeout: BROWSER_TIMEOUT_MS,
        args: ["--disable-dev-shm-usage", "--no-sandbox"]
      });

      browser = launchedBrowser;
      launchedBrowser.on("disconnected", () => {
        console.warn("[DiveSpot][DeepStation][PLAYWRIGHT] Chromium disconnected");
        clearBrowserReferences(launchedBrowser);
      });

      console.log(
        `[DiveSpot][DeepStation][PLAYWRIGHT] Chromium launch succeeded version=${launchedBrowser.version()}`
      );
      return launchedBrowser;
    } catch (error) {
      logPlaywrightFailure("launch", error);
      throw providerError(
        "Render에서 Playwright Chromium을 실행하지 못했습니다.",
        "DEEPSTATION_PLAYWRIGHT_FAILED",
        503,
        error
      );
    } finally {
      browserLaunchInFlight = null;
    }
  })();

  return browserLaunchInFlight;
}

async function resetLoginContext() {
  const previousContext = context;
  context = null;
  reservationPage = null;
  authenticatedAt = 0;

  if (previousContext) {
    await previousContext.close().catch(error => {
      logPlaywrightFailure("context-close", error);
    });
  }
}

async function createLoginPage() {
  await resetLoginContext();
  const activeBrowser = await ensureBrowser();

  try {
    context = await activeBrowser.newContext({
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      extraHTTPHeaders: {
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });
    reservationPage = await context.newPage();
    reservationPage.setDefaultTimeout(BROWSER_TIMEOUT_MS);
    reservationPage.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);
    reservationPage.on("pageerror", error => {
      console.warn("[DiveSpot][DeepStation][PAGE_ERROR]", errorDetails(error));
    });
    return reservationPage;
  } catch (error) {
    logPlaywrightFailure("context-create", error);
    await resetLoginContext();
    throw providerError(
      "Playwright Chromium 페이지를 만들지 못했습니다.",
      "DEEPSTATION_PLAYWRIGHT_FAILED",
      503,
      error
    );
  }
}

async function pageShowsLogin(activePage) {
  const pageUrl = activePage.url();
  if (/\/bbs\/login(?:\.php)?/i.test(pageUrl)) return true;

  try {
    return await activePage.locator('input[name="mb_password"], input[type="password"]').count() > 0;
  } catch {
    return true;
  }
}

function pagePathname(activePage) {
  try {
    return new URL(activePage.url()).pathname;
  } catch {
    return "";
  }
}

async function waitForUserCheck(activePage) {
  if (pagePathname(activePage) !== "/bg/check.php") return;

  console.log(
    `[DiveSpot][DeepStation][USER_CHECK] waiting url=${activePage.url()}`
  );
  await activePage.waitForURL(
    url => url.pathname !== "/bg/check.php",
    {
      waitUntil: "domcontentloaded",
      timeout: USER_CHECK_TIMEOUT_MS
    }
  ).catch(error => {
    if (error?.name !== "TimeoutError") throw error;
  });

  if (pagePathname(activePage) === "/bg/check.php") {
    throw providerError(
      "딥스테이션 사용자 확인 페이지가 제한 시간 안에 완료되지 않았습니다.",
      "DEEPSTATION_USER_CHECK_TIMEOUT",
      503
    );
  }

  await activePage.waitForLoadState("domcontentloaded").catch(() => undefined);
  console.log(
    `[DiveSpot][DeepStation][USER_CHECK] completed url=${activePage.url()}`
  );
}

async function gotoWithUserCheck(activePage, url, options = {}) {
  await activePage.goto(url, {
    waitUntil: "domcontentloaded",
    ...options
  });
  await waitForUserCheck(activePage);
}

async function waitForEntryDestination(activePage) {
  if (!["/rez/step2.php", "/bg/check.php"].includes(pagePathname(activePage))) {
    await activePage.waitForURL(
      url => ["/rez/step2.php", "/bg/check.php"].includes(url.pathname),
      { timeout: ENTRY_TIMEOUT_MS }
    ).catch(error => {
      if (error?.name !== "TimeoutError") throw error;
    });
  }

  await waitForUserCheck(activePage);
  await activePage.waitForLoadState("domcontentloaded").catch(() => undefined);
}

async function waitForEntryAction(activePage, action) {
  let result;
  try {
    result = await action();
  } catch (error) {
    await waitForEntryDestination(activePage);
    if (pagePathname(activePage) !== "/rez/step2.php") throw error;
    result = { acted: true, strategy: "navigation-during-action" };
  }

  if (!result?.acted || pagePathname(activePage) === "/rez/step2.php") {
    return result;
  }

  await waitForEntryDestination(activePage);
  return result;
}

async function submitFreedivingStep1Form(activePage) {
  return waitForEntryAction(activePage, () => activePage.evaluate(() => {
    const desired = "프리다이빙";
    const marker = element => {
      const images = Array.from(element.querySelectorAll?.("img") || [])
        .map(image => `${image.alt || ""} ${image.title || ""} ${image.src || ""}`)
        .join(" ");
      const fields = Array.from(element.querySelectorAll?.("input, select, button") || [])
        .map(field => `${field.name || ""} ${field.value || ""}`)
        .join(" ");
      return [
        element.innerText,
        element.textContent,
        element.value,
        element.getAttribute?.("action"),
        element.getAttribute?.("href"),
        element.getAttribute?.("onclick"),
        images,
        fields
      ].filter(Boolean).join(" ");
    };
    const isFreediving = value => /프리\s*다이빙|free\s*div|freediv/i.test(String(value || ""));
    const forms = Array.from(document.forms);
    const scored = forms.map(form => {
      const action = form.getAttribute("action") || "";
      const text = marker(form);
      const hasRtype = Boolean(form.querySelector('[name="rtype"]'));
      let score = 0;
      if (/step2\.php/i.test(action)) score += 4;
      if (hasRtype) score += 3;
      if (isFreediving(text)) score += 2;
      return { form, score };
    }).sort((a, b) => b.score - a.score);

    const selected = scored[0];
    if (!selected || selected.score < 3) {
      return { acted: false, strategy: "form", formCount: forms.length };
    }

    const form = selected.form;
    const rtypeFields = Array.from(form.querySelectorAll('[name="rtype"]'));
    let choseFreediving = false;

    for (const field of rtypeFields) {
      const fieldMarker = marker(field.parentElement || field);
      if (field.tagName === "SELECT") {
        const option = Array.from(field.options).find(item => isFreediving(`${item.value} ${item.text}`));
        if (option) {
          field.value = option.value;
          choseFreediving = true;
        }
      } else if (field.type === "radio" || field.type === "checkbox") {
        if (isFreediving(`${field.value} ${fieldMarker}`)) {
          field.checked = true;
          choseFreediving = true;
        }
      } else {
        // 선택된 프리다이빙 폼에 서버가 넣어 둔 값이 있으면 그대로 보존한다.
        if (!field.value) field.value = desired;
        choseFreediving = true;
      }

      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const submitters = Array.from(form.querySelectorAll(
      'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]'
    ));
    const submitter = submitters.find(element => isFreediving(marker(element)))
      || submitters.find(element => element.type === "submit")
      || null;

    if (submitter) submitter.click();
    else if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();

    return {
      acted: true,
      strategy: "form",
      choseFreediving,
      action: form.getAttribute("action") || ""
    };
  }));
}

async function clickFreedivingStep1Control(activePage) {
  return waitForEntryAction(activePage, () => activePage.evaluate(() => {
    const marker = element => {
      const images = Array.from(element.querySelectorAll?.("img") || [])
        .map(image => `${image.alt || ""} ${image.title || ""} ${image.src || ""}`)
        .join(" ");
      return [
        element.innerText,
        element.textContent,
        element.value,
        element.getAttribute?.("href"),
        element.getAttribute?.("onclick"),
        element.getAttribute?.("aria-label"),
        images
      ].filter(Boolean).join(" ");
    };
    const controls = Array.from(document.querySelectorAll(
      'a, button, input[type="submit"], input[type="button"], input[type="image"], [role="button"], [onclick]'
    ));
    const freediving = controls.filter(element => /프리\s*다이빙|free\s*div/i.test(marker(element)));
    const selected = freediving.find(element => /step2\.php|\/rez\//i.test(marker(element)))
      || freediving[0];

    if (!selected) {
      return { acted: false, strategy: "control", controlCount: controls.length };
    }

    const description = marker(selected).replace(/\s+/g, " ").trim().slice(0, 160);
    selected.click();
    return { acted: true, strategy: "control", description };
  }));
}

async function followFreedivingStep1Link(activePage) {
  const href = await activePage.evaluate(() => {
    const marker = element => {
      const images = Array.from(element.querySelectorAll?.("img") || [])
        .map(image => `${image.alt || ""} ${image.title || ""} ${image.src || ""}`)
        .join(" ");
      return [
        element.innerText,
        element.textContent,
        element.getAttribute?.("href"),
        element.getAttribute?.("aria-label"),
        images
      ].filter(Boolean).join(" ");
    };
    const links = Array.from(document.querySelectorAll("a[href]"));
    const selected = links.find(element => (
      /프리\s*다이빙|free\s*div/i.test(marker(element))
      && /step2\.php|[?&]rtype=/i.test(element.href || "")
    ));
    return selected?.href || "";
  });

  if (!href) return { acted: false, strategy: "href" };
  await gotoWithUserCheck(activePage, href, { timeout: ENTRY_TIMEOUT_MS });
  return { acted: true, strategy: "href", href };
}

async function enterFreedivingStep2(activePage) {
  if (pagePathname(activePage) === "/rez/step2.php") return "already-step2";

  if (pagePathname(activePage) !== "/rez/step1.php") {
    await gotoWithUserCheck(activePage, STEP1_URL);
  }

  if (await pageShowsLogin(activePage)) {
    throw providerError(
      "딥스테이션 로그인 세션이 만료되었습니다.",
      "DEEPSTATION_LOGIN_FAILED",
      503
    );
  }

  const attempts = [];
  const linkResult = await followFreedivingStep1Link(activePage).catch(error => ({
    acted: false,
    strategy: "href",
    error: error?.message || String(error)
  }));
  attempts.push(linkResult);
  if (pagePathname(activePage) === "/rez/step2.php") {
    console.log("[DiveSpot][DeepStation][STEP2] entered via freediving link");
    return "href";
  }

  if (pagePathname(activePage) !== "/rez/step1.php") {
    await gotoWithUserCheck(activePage, STEP1_URL);
  }
  const formResult = await submitFreedivingStep1Form(activePage);
  attempts.push(formResult);
  if (pagePathname(activePage) === "/rez/step2.php") {
    console.log("[DiveSpot][DeepStation][STEP2] entered via step1 form");
    return "form";
  }

  if (pagePathname(activePage) !== "/rez/step1.php") {
    await gotoWithUserCheck(activePage, STEP1_URL);
  }
  const controlResult = await clickFreedivingStep1Control(activePage);
  attempts.push(controlResult);
  if (pagePathname(activePage) === "/rez/step2.php") {
    console.log("[DiveSpot][DeepStation][STEP2] entered via freediving control");
    return "control";
  }

  const step2WithType = `${RESERVATION_URL}?rtype=${encodeURIComponent("프리다이빙")}`;
  await gotoWithUserCheck(activePage, step2WithType, {
    timeout: ENTRY_TIMEOUT_MS
  }).catch(error => {
    attempts.push({
      acted: false,
      strategy: "typed-url",
      error: error?.message || String(error)
    });
  });
  if (pagePathname(activePage) === "/rez/step2.php") {
    console.log("[DiveSpot][DeepStation][STEP2] entered via typed URL");
    return "typed-url";
  }

  console.error(
    `[DiveSpot][DeepStation][STEP2_FAILURE] finalUrl=${redactSensitiveText(activePage.url())} attempts=${redactSensitiveText(JSON.stringify(attempts))}`
  );
  throw providerError(
    "딥스테이션 프리다이빙 예약 2단계 페이지에 진입하지 못했습니다.",
    "DEEPSTATION_RESERVATION_PAGE_FAILED",
    503
  );
}

async function doLogin() {
  const { id, password } = credentials();
  if (!id || !password) {
    throw providerError(
      "Render 환경변수 DEEPSTATION_ID와 DEEPSTATION_PASSWORD를 설정해 주세요.",
      "DEEPSTATION_CREDENTIALS_REQUIRED",
      503
    );
  }

  const activePage = await createLoginPage();
  await activePage.goto(LOGIN_PAGE_URL, { waitUntil: "domcontentloaded" });

  const idInput = activePage.locator(
    'input[name="mb_id"], #login_id, input[autocomplete="username"], input[type="email"]'
  ).first();
  const passwordInput = activePage.locator(
    'input[name="mb_password"], #login_pw, input[autocomplete="current-password"], input[type="password"]'
  ).first();

  if (await idInput.count() === 0 || await passwordInput.count() === 0) {
    throw providerError(
      "딥스테이션 로그인 입력란을 찾지 못했습니다.",
      "DEEPSTATION_LOGIN_FORM_NOT_FOUND",
      503
    );
  }

  await idInput.fill(id);
  await passwordInput.fill(password);

  const loginForm = passwordInput.locator("xpath=ancestor::form[1]");
  if (await loginForm.count() === 0) {
    throw providerError(
      "딥스테이션 로그인 폼을 찾지 못했습니다.",
      "DEEPSTATION_LOGIN_FORM_NOT_FOUND",
      503
    );
  }

  let dialogMessage = "";
  const dialogHandler = async dialog => {
    dialogMessage = dialog.message();
    await dialog.dismiss().catch(() => undefined);
  };
  activePage.on("dialog", dialogHandler);

  try {
    const navigation = activePage
      .waitForNavigation({ waitUntil: "domcontentloaded" })
      .catch(error => {
        if (error?.name === "TimeoutError") return null;
        throw error;
      });

    await loginForm.evaluate(form => {
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.submit();
    });
    await navigation;

    // 예약 1단계에서 프리다이빙을 실제로 선택해 2단계로 진입한다.
    await gotoWithUserCheck(activePage, STEP1_URL);

    if (await pageShowsLogin(activePage)) {
      throw providerError(
        dialogMessage
          ? `딥스테이션 로그인에 실패했습니다: ${responsePreview(dialogMessage, 120)}`
          : "딥스테이션 로그인에 실패했습니다. 아이디와 비밀번호를 확인해 주세요.",
        "DEEPSTATION_LOGIN_FAILED",
        503
      );
    }

    const entryStrategy = await enterFreedivingStep2(activePage);

    authenticatedAt = Date.now();
    console.log(
      `[DiveSpot][DeepStation][LOGIN] succeeded step2=${activePage.url()} strategy=${entryStrategy}`
    );
    return activePage;
  } finally {
    activePage.off("dialog", dialogHandler);
  }
}

async function performLogin() {
  try {
    return await doLogin();
  } catch (error) {
    logLoginFailure("authenticate", error, reservationPage?.url?.() || "");
    await resetLoginContext();
    throw error?.code
      ? error
      : providerError(
        "딥스테이션 로그인 중 브라우저 오류가 발생했습니다.",
        "DEEPSTATION_LOGIN_FAILED",
        503,
        error
      );
  }
}

function hasReusableSession() {
  return Boolean(
    browser?.isConnected()
    && context
    && reservationPage
    && !reservationPage.isClosed()
    && authenticatedAt > 0
    && Date.now() - authenticatedAt < SESSION_TTL_MS
  );
}

async function ensureAuthenticated(force = false) {
  if (!force && hasReusableSession()) return reservationPage;
  return performLogin();
}

async function ensureStep2Page(activePage) {
  if (await pageShowsLogin(activePage)) {
    return false;
  }

  if (pagePathname(activePage) !== "/rez/step2.php") {
    try {
      await enterFreedivingStep2(activePage);
    } catch (error) {
      if (await pageShowsLogin(activePage)) return false;
      throw error;
    }
  }

  if (pagePathname(activePage) !== "/rez/step2.php") return false;
  return true;
}

async function fetchAvailabilityPayload(activePage, date) {
  const onReservationPage = await ensureStep2Page(activePage);
  if (!onReservationPage) {
    return { loggedOut: true, payload: null, status: 401, ok: false, preview: "login page" };
  }

  const requestPath = buildDayInfoPath(date);
  let raw;
  try {
    raw = await activePage.evaluate(async path => {
      try {
        const response = await fetch(path, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest"
          }
        });
        return {
          ok: response.ok,
          status: response.status,
          url: response.url,
          redirected: response.redirected,
          text: await response.text()
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          url: "",
          redirected: false,
          text: "",
          fetchError: error?.message || String(error)
        };
      }
    }, requestPath);
  } catch (error) {
    logPlaywrightFailure("same-origin-fetch", error);
    throw providerError(
      "Chromium에서 딥스테이션 잔여석 요청을 실행하지 못했습니다.",
      "DEEPSTATION_PLAYWRIGHT_FAILED",
      502,
      error
    );
  }

  const preview = responsePreview(raw.text);
  console.log(
    `[DiveSpot][DeepStation][RESPONSE_PREVIEW] date=${date} status=${raw.status} url=${raw.url || "(none)"} body=${JSON.stringify(preview)}`
  );

  if (raw.fetchError) {
    throw providerError(
      `딥스테이션 동일 출처 요청에 실패했습니다: ${responsePreview(raw.fetchError, 160)}`,
      "DEEPSTATION_REQUEST_FAILED",
      502
    );
  }

  let payload = null;
  try {
    payload = JSON.parse(raw.text);
  } catch {
    // 로그인 HTML이나 오류 HTML은 아래에서 구분한다.
  }

  const loggedOut = /\/bbs\/login(?:\.php)?/i.test(raw.url || "")
    || /name=["']mb_password["']|type=["']password["']/i.test(raw.text || "");
  const wrongPathMessage = String(payload?.msg || payload?.message || "");
  const wrongPath = /올바른\s*경로/.test(wrongPathMessage);
  const sessionRejected = loggedOut
    || /올바른\s*경로|로그인/i.test(wrongPathMessage)
    || !Array.isArray(payload?.remain?.gen);

  return {
    payload,
    status: raw.status,
    ok: raw.ok,
    loggedOut,
    wrongPath,
    sessionRejected,
    preview
  };
}

async function requestAvailabilityLocked(date) {
  let activePage = await ensureAuthenticated(false);
  let result = await fetchAvailabilityPayload(activePage, date);

  if (result.wrongPath && !result.loggedOut) {
    console.warn(
      `[DiveSpot][DeepStation][STEP2] route state rejected; re-entering without login date=${date}`
    );
    await gotoWithUserCheck(activePage, STEP1_URL);
    await enterFreedivingStep2(activePage);
    result = await fetchAvailabilityPayload(activePage, date);
  }

  if (result.sessionRejected) {
    console.warn(
      `[DiveSpot][DeepStation][SESSION] rejected; automatic re-login date=${date} status=${result.status}`
    );
    activePage = await ensureAuthenticated(true);
    result = await fetchAvailabilityPayload(activePage, date);
  }

  if (result.loggedOut) {
    const error = providerError(
      "딥스테이션 세션이 만료되어 자동 재로그인했지만 로그인 페이지로 이동했습니다.",
      "DEEPSTATION_LOGIN_FAILED",
      503
    );
    logLoginFailure("session-refresh", error, activePage.url());
    throw error;
  }

  if (!result.payload) {
    throw providerError(
      `딥스테이션에서 JSON 응답을 받지 못했습니다. 응답 일부: ${result.preview || "(empty)"}`,
      "DEEPSTATION_BAD_RESPONSE",
      502
    );
  }

  if (!result.ok || result.status >= 400) {
    throw providerError(
      result.payload?.message || result.payload?.msg || `딥스테이션 요청이 실패했습니다. (${result.status})`,
      "DEEPSTATION_REQUEST_FAILED",
      result.status >= 400 ? result.status : 502
    );
  }

  if (!Array.isArray(result.payload?.remain?.gen)) {
    throw providerError(
      `딥스테이션 JSON에 remain.gen이 없습니다. 응답 일부: ${result.preview || "(empty)"}`,
      "DEEPSTATION_BAD_RESPONSE",
      502
    );
  }

  return normalizeSessions(result.payload);
}

async function requestAvailability(date) {
  return runBrowserOperation(() => requestAvailabilityLocked(date));
}

async function getAvailability(date) {
  const cached = cache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.sessions;

  const pending = inFlight.get(date);
  if (pending) return pending;

  const request = requestAvailability(date).then(sessions => {
    cache.set(date, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      sessions
    });
    return sessions;
  });

  inFlight.set(date, request);
  try {
    return await request;
  } finally {
    inFlight.delete(date);
  }
}

async function runChromiumDiagnostic() {
  return runBrowserOperation(async () => {
    const activeBrowser = await ensureBrowser();
    let diagnosticContext;

    try {
      diagnosticContext = await activeBrowser.newContext({ locale: "ko-KR" });
      const diagnosticPage = await diagnosticContext.newPage();
      diagnosticPage.setDefaultTimeout(BROWSER_TIMEOUT_MS);
      await diagnosticPage.goto("data:text/html,<title>DiveSpot Chromium Test</title><h1>ok</h1>");
      const details = await diagnosticPage.evaluate(() => ({
        title: document.title,
        userAgent: navigator.userAgent,
        platform: navigator.platform
      }));

      return {
        ok: true,
        browser: "chromium",
        version: activeBrowser.version(),
        headless: true,
        pageTitle: details.title,
        userAgent: details.userAgent,
        platform: details.platform,
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      logPlaywrightFailure("diagnostic", error);
      throw providerError(
        "Playwright Chromium 진단에 실패했습니다.",
        "DEEPSTATION_PLAYWRIGHT_FAILED",
        503,
        error
      );
    } finally {
      await diagnosticContext?.close().catch(error => {
        logPlaywrightFailure("diagnostic-context-close", error);
      });
    }
  });
}

async function testChromium() {
  if (
    diagnosticCache
    && diagnosticCache.expiresAt > Date.now()
    && browser?.isConnected()
  ) {
    return { ...diagnosticCache.result, cached: true };
  }

  if (!diagnosticInFlight) {
    diagnosticInFlight = runChromiumDiagnostic()
      .then(result => {
        diagnosticCache = {
          expiresAt: Date.now() + DIAGNOSTIC_TTL_MS,
          result
        };
        return result;
      })
      .finally(() => {
        diagnosticInFlight = null;
      });
  }

  return diagnosticInFlight;
}

async function closeBrowser() {
  await runBrowserOperation(async () => {
    const activeContext = context;
    const activeBrowser = browser;
    clearBrowserReferences();
    await activeContext?.close().catch(() => undefined);
    await activeBrowser?.close().catch(error => {
      logPlaywrightFailure("browser-close", error);
    });
  });
}

module.exports = {
  buildDayInfoPath,
  closeBrowser,
  getAvailability,
  normalizeSessions,
  redactSensitiveText,
  waitForUserCheck,
  testChromium
};
