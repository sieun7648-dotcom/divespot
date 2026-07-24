(() => {
  "use strict";

  const META = {
    paradive: {
      name: "PARADIVE",
      subtitle: "파라다이브 예약 현황",
      url: "https://paradive.co.kr/service/pc/page/reservation01.php"
    },
    deepstation: {
      name: "DEEP STATION",
      subtitle: "딥스테이션 예약 현황",
      url: "https://deepstation.kr/rez/step2.php"
    }
  };

  const CONFIG = window.DIVESPOT_CONFIG || {};
  const API_BASE_URL = String(CONFIG.apiBaseUrl || "").replace(/\/+$/, "");
  const BACKEND_STARTUP_TIMEOUT_MS = Number(CONFIG.backendStartupTimeoutMs) || 90000;
  const REQUEST_TIMEOUT_MS = Number(CONFIG.requestTimeoutMs) || 30000;

  const els = {
    date: document.querySelector("#dateInput"),
    refresh: document.querySelector("#refreshButton"),
    list: document.querySelector("#facilityList"),
    notice: document.querySelector("#notice"),
    time: document.querySelector("#updateTime"),
    help: document.querySelector("#helpButton"),
    dialog: document.querySelector("#helpDialog"),
    close: document.querySelector("#closeHelpButton"),
    paradiveStatusIcon: document.querySelector("#paradiveStatusIcon"),
    paradiveStatusText: document.querySelector("#paradiveStatusText"),
    deepstationStatusIcon: document.querySelector("#deepstationStatusIcon"),
    deepstationStatusText: document.querySelector("#deepstationStatusText")
  };

  let loadSequence = 0;
  let activeController = null;

  const FACILITY_KEYS = ["paradive", "deepstation"];
  const SELECTED_DATE_KEY = "divespot_selected_date";
  const AVAILABILITY_CACHE_PREFIX = "divespot_availability_v1:";
  const RETRY_DELAYS_MS = [0, 2000, 5000];
  const pad = n => String(n).padStart(2, "0");

  const validDate = value => {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const parsed = new Date(`${text}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime())
      && parsed.toISOString().slice(0, 10) === text;
  };

  function koreaDate(date = new Date()) {
    const values = {};
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    parts.forEach(part => {
      if (part.type !== "literal") values[part.type] = part.value;
    });
    return `${values.year}-${values.month}-${values.day}`;
  }

  function addCalendarMonths(value, amount) {
    const [year, month, day] = value.split("-").map(Number);
    const monthIndex = month - 1 + amount;
    const targetYear = year + Math.floor(monthIndex / 12);
    const targetMonthIndex = ((monthIndex % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
    return [
      String(targetYear).padStart(4, "0"),
      String(targetMonthIndex + 1).padStart(2, "0"),
      String(Math.min(day, lastDay)).padStart(2, "0")
    ].join("-");
  }

  const MIN_SELECTABLE_DATE = koreaDate();
  const MAX_SELECTABLE_DATE = addCalendarMonths(MIN_SELECTABLE_DATE, 2);
  const selectableDate = value => validDate(value)
    && value >= MIN_SELECTABLE_DATE
    && value <= MAX_SELECTABLE_DATE;

  function readSelectedDate() {
    try {
      const saved = localStorage.getItem(SELECTED_DATE_KEY);
      return selectableDate(saved) ? saved : MIN_SELECTABLE_DATE;
    } catch {
      return MIN_SELECTABLE_DATE;
    }
  }

  function saveSelectedDate(value) {
    if (!selectableDate(value)) return;
    try {
      localStorage.setItem(SELECTED_DATE_KEY, value);
    } catch {
      // 저장 공간을 사용할 수 없는 환경에서는 현재 화면의 날짜만 사용합니다.
    }
  }

  function readCachedAvailability(date) {
    try {
      const cached = JSON.parse(localStorage.getItem(`${AVAILABILITY_CACHE_PREFIX}${date}`));
      if (!cached || cached.date !== date || !Number.isFinite(cached.updatedAt)) return null;
      const facilities = {};
      for (const key of FACILITY_KEYS) {
        if (!cached.facilities?.[key]?.connected) continue;
        facilities[key] = normalizeFacility(cached.facilities[key], key);
      }
      return Object.keys(facilities).length ? { ...cached, facilities } : null;
    } catch {
      return null;
    }
  }

  function saveCachedAvailability(date, facilities) {
    const successful = {};
    for (const key of FACILITY_KEYS) {
      if (facilities[key]?.connected) successful[key] = facilities[key];
    }
    if (!Object.keys(successful).length) return;

    try {
      localStorage.setItem(`${AVAILABILITY_CACHE_PREFIX}${date}`, JSON.stringify({
        date,
        updatedAt: Date.now(),
        facilities: successful
      }));
    } catch {
      // 저장 공간이 없거나 차단된 환경에서도 현재 조회 결과는 정상 표시한다.
    }
  }

  function apiUrl(pathname) {
    return API_BASE_URL ? `${API_BASE_URL}${pathname}` : pathname;
  }

  function abortError() {
    return new DOMException("요청이 취소되었습니다.", "AbortError");
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }

      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const parentSignal = options.signal;
    let timedOut = false;
    const onParentAbort = () => controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    if (parentSignal?.aborted) controller.abort();
    else parentSignal?.addEventListener("abort", onParentAbort, { once: true });

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (parentSignal?.aborted) throw abortError();
      if (timedOut) throw new Error("조회 요청 시간이 초과되었습니다.");
      throw error;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
  }

  async function fetchWithRetry(url, options, signal) {
    let lastError;
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
      if (RETRY_DELAYS_MS[attempt]) await sleep(RETRY_DELAYS_MS[attempt], signal);
      try {
        const response = await fetchWithTimeout(url, options, REQUEST_TIMEOUT_MS);
        if (response.ok || ![502, 503, 504].includes(response.status)) return response;
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        if (error?.name === "AbortError" && signal.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError || new Error("조회 서버에 연결하지 못했습니다.");
  }

  async function waitForBackend(signal) {
    const deadline = Date.now() + BACKEND_STARTUP_TIMEOUT_MS;
    let lastError = null;

    while (Date.now() < deadline) {
      if (signal.aborted) throw abortError();
      const remaining = deadline - Date.now();

      try {
        const response = await fetchWithTimeout(apiUrl("/api/health"), {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal
        }, Math.min(20000, remaining));

        if (response.ok) return;
        if (![502, 503, 504].includes(response.status)) {
          throw new Error(`조회 서버 응답 오류 (HTTP ${response.status})`);
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        if (error?.name === "AbortError" && signal.aborted) throw error;
        lastError = error;
      }

      await sleep(Math.min(2500, Math.max(0, deadline - Date.now())), signal);
    }

    throw new Error(lastError?.message || "조회 서버 시작 시간이 초과되었습니다.");
  }

  function num(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function normalizeSession(raw, index) {
    return {
      part: raw.part ?? raw.session ?? raw.name ?? `${index + 1}부`,
      time: raw.time ?? raw.hours ?? raw.period ?? "",
      people: num(raw.people ?? raw.remainingPeople ?? raw.remaining_people ?? raw.available),
      front: num(raw.front ?? raw.frontBuoy ?? raw.front_buoy ?? raw.buoyFront),
      back: num(raw.back ?? raw.backBuoy ?? raw.back_buoy ?? raw.buoyBack)
    };
  }

  function normalizeFacility(raw, key) {
    const src = raw ?? {};
    const sessions = src.sessions ?? src.items ?? src.availability ?? src.parts ?? [];
    return {
      key,
      connected: src.connected !== false,
      error: src.error?.message || "",
      sessions: Array.isArray(sessions) ? sessions.map(normalizeSession) : []
    };
  }

  function statusClass(value) {
    const n = num(value);
    if (n === null) return "unknown";
    if (n <= 0) return "closed";
    if (n <= 5) return "limited";
    return "available";
  }

  function display(value, unit = "") {
    const n = num(value);
    if (n === null) return "-";
    if (n <= 0) return "마감";
    return `${n}${unit}`;
  }

  function displayBuoy(value, facilityKey) {
    const n = num(value);
    if (n === null) return "-";
    if (facilityKey === "paradive") return n > 0 ? "예약 가능" : "마감";
    return n > 0 ? `${n}석` : "마감";
  }

  function buoyHero(value, facilityKey) {
    if (facilityKey !== "paradive") return `<strong>${value}</strong><small>석</small>`;
    return `<strong>${value > 0 ? `${value}부` : "마감"}</strong><small>${value > 0 ? "예약 가능" : ""}</small>`;
  }

  function summary(sessions) {
    return sessions.reduce((acc, item) => {
      acc.people += Math.max(num(item.people) ?? 0, 0);
      acc.front += Math.max(num(item.front) ?? 0, 0);
      acc.back += Math.max(num(item.back) ?? 0, 0);
      return acc;
    }, { people: 0, front: 0, back: 0 });
  }

  function overall(sessions) {
    const values = sessions.map(x => num(x.people)).filter(x => x !== null);
    if (!values.length) return { cls: "closed", label: "확인 필요" };
    const total = values.reduce((a, b) => a + b, 0);
    const max = Math.max(...values);
    if (total <= 0) return { cls: "closed", label: "전체 마감" };
    if (max <= 5) return { cls: "limited", label: "마감 임박" };
    return { cls: "available", label: "예약 가능" };
  }

  function esc(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderFacility(facility) {
    const meta = META[facility.key];
    const sum = summary(facility.sessions);
    const state = overall(facility.sessions);

    const rows = facility.sessions.map(s => `
      <tr>
        <td class="part">${esc(s.part)}</td>
        <td class="time">${esc(s.time || "-")}</td>
        <td><span class="value ${statusClass(s.people)}">${display(s.people, "명")}</span></td>
        <td><span class="value ${statusClass(s.front)}">${displayBuoy(s.front, facility.key)}</span></td>
        <td><span class="value ${statusClass(s.back)}">${displayBuoy(s.back, facility.key)}</span></td>
      </tr>
    `).join("");

    const emptyMessage = facility.error || "조회 데이터가 없습니다.";

    return `
      <article class="facility-card ${facility.key}">
        <div class="facility-hero">
          <div class="facility-title">
            <h2>${meta.name}</h2>
            <span class="facility-badge ${state.cls}">${state.label}</span>
          </div>
          <div class="hero-stat">
            <span>총 잔여 인원</span>
            <strong>${sum.people}</strong><small>명</small>
          </div>
          <div class="hero-stat">
            <span>전반 부이</span>
            ${buoyHero(sum.front, facility.key)}
          </div>
          <div class="hero-stat">
            <span>후반 부이</span>
            ${buoyHero(sum.back, facility.key)}
          </div>
        </div>

        <div class="table-wrap">
          <table class="session-table">
            <thead>
              <tr>
                <th>시간</th>
                <th class="time-column"></th>
                <th>추가 예약 가능 인원</th>
                <th>35M 부이 전반</th>
                <th>35M 부이 후반</th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="5">${esc(emptyMessage)}</td></tr>`}</tbody>
          </table>
        </div>

        <div class="facility-footer">
          <a class="booking-button" href="${meta.url}" target="_blank" rel="noopener noreferrer">
            ${meta.subtitle.replace(" 예약 현황", "")} 공식 예약페이지로 이동
          </a>
        </div>
      </article>
    `;
  }

  function setNotice(message, tone = "warning") {
    els.notice.hidden = !message;
    els.notice.textContent = message;
    els.notice.dataset.tone = tone;
  }

  function setLoading(value) {
    els.refresh.disabled = value;
    els.refresh.classList.toggle("loading", value);
  }

  function renderLoadingCard(key) {
    return `
      <article class="facility-card skeleton ${key}" aria-label="${META[key].name} 조회 중">
        <span>${META[key].name} 예약 현황을 불러오는 중...</span>
      </article>
    `;
  }

  function renderState(state) {
    els.list.innerHTML = FACILITY_KEYS
      .map(key => state[key] ? renderFacility(state[key]) : renderLoadingCard(key))
      .join("");
  }

  function setConnectionPending(label = "확인 중") {
    const items = [
      [els.paradiveStatusIcon, els.paradiveStatusText],
      [els.deepstationStatusIcon, els.deepstationStatusText]
    ];

    for (const [icon, text] of items) {
      if (icon) {
        icon.textContent = "…";
        icon.classList.remove("disconnected");
      }
      if (text) text.textContent = label;
    }
  }

  function updateConnectionStatus(facilities) {
    for (const facility of facilities) {
      const icon = facility.key === "paradive" ? els.paradiveStatusIcon : els.deepstationStatusIcon;
      const text = facility.key === "paradive" ? els.paradiveStatusText : els.deepstationStatusText;
      const connected = facility.connected && facility.sessions.length > 0;
      if (icon) {
        icon.textContent = connected ? "✓" : "!";
        icon.classList.toggle("disconnected", !connected);
      }
      if (text) text.textContent = connected ? "연결됨" : "확인 필요";
    }
  }

  async function fetchAvailability(date, signal) {
    const response = await fetchWithRetry(
      apiUrl(`/api/availability?date=${encodeURIComponent(date)}`),
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal
      },
      signal
    );

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // JSON이 아닌 오류 응답은 아래의 공통 메시지로 처리합니다.
    }

    if (!response.ok || payload?.ok === false) {
      const message = payload?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }

    return Object.fromEntries(FACILITY_KEYS.map(key => [
      key,
      normalizeFacility(payload?.facilities?.[key], key)
    ]));
  }

  async function load() {
    const sequence = ++loadSequence;
    activeController?.abort();
    activeController = new AbortController();
    const { signal } = activeController;

    const date = selectableDate(els.date.value) ? els.date.value : readSelectedDate();
    els.date.value = date;
    saveSelectedDate(date);

    const cached = readCachedAvailability(date);
    const state = {
      paradive: cached?.facilities?.paradive || null,
      deepstation: cached?.facilities?.deepstation || null
    };
    const errors = {};
    renderState(state);
    if (cached) {
      updateConnectionStatus(Object.values(cached.facilities));
      const savedAt = new Date(cached.updatedAt);
      els.time.textContent = `${pad(savedAt.getHours())}:${pad(savedAt.getMinutes())} 저장된 정보`;
    } else {
      setConnectionPending("확인 중");
      els.time.textContent = "저장된 정보 없음";
    }
    setLoading(true);
    setNotice("최신 정보를 확인하고 있습니다.", "loading");

    const startupTimers = [
      setTimeout(() => {
        if (sequence === loadSequence && !signal.aborted) {
          setNotice("최신 정보를 확인하고 있습니다. 서버가 시작되는 동안에도 화면을 계속 사용할 수 있어요.", "loading");
        }
      }, 3500),
      setTimeout(() => {
        if (sequence === loadSequence && !signal.aborted) {
          setNotice("최신 정보를 확인하고 있습니다. 준비되면 자동으로 갱신됩니다.", "loading");
        }
      }, 30000)
    ];

    try {
      await waitForBackend(signal);
    } catch (error) {
      startupTimers.forEach(clearTimeout);
      if (error?.name === "AbortError" || sequence !== loadSequence) return;

      const message = cached
        ? "최신 정보를 가져오지 못해 저장된 결과를 표시하고 있습니다."
        : "예약 조회 서버에 연결하지 못했습니다. 잠시 후 전체 새로고침을 눌러주세요.";
      if (!cached) {
        for (const key of FACILITY_KEYS) {
          state[key] = normalizeFacility({ connected: false, error: { message }, sessions: [] }, key);
        }
        renderState(state);
        updateConnectionStatus(Object.values(state));
      }
      setNotice(message, "error");
      setLoading(false);
      return;
    }

    startupTimers.forEach(clearTimeout);
    if (sequence !== loadSequence) return;
    setConnectionPending("조회 중");
    setNotice("서버가 준비됐습니다. 예약 현황을 확인하고 있어요.", "loading");
    els.time.textContent = "조회 중...";

    try {
      const latest = await fetchAvailability(date, signal);
      if (sequence !== loadSequence) return;
      for (const key of FACILITY_KEYS) {
        if (latest[key].connected) {
          state[key] = latest[key];
        } else if (cached?.facilities?.[key]) {
          state[key] = cached.facilities[key];
          errors[key] = `${META[key].name}: 최신 조회 실패, 저장된 결과 표시 중`;
        } else {
          state[key] = latest[key];
          errors[key] = `${META[key].name}: ${latest[key].error || "연결 실패"}`;
        }
      }
      renderState(state);
      updateConnectionStatus(Object.values(state));
      saveCachedAvailability(date, state);
    } catch (error) {
      if (error?.name === "AbortError" || sequence !== loadSequence) return;
      console.warn("[DiveSpot] availability load failed", error);
      const message = error?.message || "연결 실패";
      if (!cached) {
        for (const key of FACILITY_KEYS) {
          state[key] = normalizeFacility({ connected: false, error: { message }, sessions: [] }, key);
        }
        renderState(state);
        updateConnectionStatus(Object.values(state));
      }
      errors.all = cached
        ? "최신 정보를 가져오지 못해 저장된 결과를 표시하고 있습니다."
        : message;
    }

    if (sequence !== loadSequence) return;
    const errorMessage = errors.all
      || FACILITY_KEYS.map(item => errors[item]).filter(Boolean).join(" · ");
    setNotice(errorMessage, errorMessage ? "error" : "warning");
    const now = new Date();
    els.time.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())} 업데이트`;
    setLoading(false);
  }

  els.date.min = MIN_SELECTABLE_DATE;
  els.date.max = MAX_SELECTABLE_DATE;
  els.date.value = readSelectedDate();
  els.refresh.addEventListener("click", () => {
    saveSelectedDate(els.date.value);
    load();
  });
  els.date.addEventListener("change", () => {
    const selected = selectableDate(els.date.value) ? els.date.value : MIN_SELECTABLE_DATE;
    els.date.value = selected;
    saveSelectedDate(selected);
    load();
  });
  window.addEventListener("pagehide", () => saveSelectedDate(els.date.value));

  els.help.addEventListener("click", () => els.dialog.showModal());
  els.close.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", event => {
    if (event.target === els.dialog) els.dialog.close();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load, { once: true });
  } else {
    load();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js?v=11")
        .catch(error => console.warn("[DiveSpot] service worker registration failed", error));
    }, { once: true });
  }
})();
