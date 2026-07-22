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

  let loading = false;
  let loadSequence = 0;
  let activeController = null;

  const FACILITY_KEYS = ["paradive", "deepstation"];

  const SELECTED_DATE_KEY = "divespot_selected_date";
  const pad = n => String(n).padStart(2, "0");
  const localDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

  function readSelectedDate() {
    try {
      const saved = localStorage.getItem(SELECTED_DATE_KEY);
      return validDate(saved) ? saved : localDate(new Date());
    } catch {
      return localDate(new Date());
    }
  }

  function saveSelectedDate(value) {
    if (!validDate(value)) return;
    try {
      localStorage.setItem(SELECTED_DATE_KEY, value);
    } catch {
      // 저장 공간을 사용할 수 없는 환경에서는 현재 화면의 날짜만 사용합니다.
    }
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

  function normalize(payload) {
    const root = payload?.data ?? payload?.facilities ?? payload ?? {};
    return [
      normalizeFacility(root.paradive ?? root.paraDive ?? root.PARADIVE, "paradive"),
      normalizeFacility(root.deepstation ?? root.deepStation ?? root.DEEPSTATION, "deepstation")
    ];
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
    const total = values.reduce((a,b) => a+b, 0);
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

  function setNotice(message) {
    els.notice.hidden = !message;
    els.notice.textContent = message;
  }

  function setLoading(value) {
    loading = value;
    els.refresh.disabled = value;
    els.refresh.classList.toggle("loading", value);
  }

  function renderLoadingCard(key) {
    return `<div class="facility-card skeleton ${key}" aria-label="${META[key].name} 조회 중"></div>`;
  }

  function renderState(state) {
    els.list.innerHTML = FACILITY_KEYS
      .map(key => state[key] ? renderFacility(state[key]) : renderLoadingCard(key))
      .join("");
  }

  function setConnectionPending() {
    const items = [
      [els.paradiveStatusIcon, els.paradiveStatusText],
      [els.deepstationStatusIcon, els.deepstationStatusText]
    ];

    for (const [icon, text] of items) {
      if (icon) {
        icon.textContent = "…";
        icon.classList.remove("disconnected");
      }
      if (text) text.textContent = "확인 중";
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

  function render(facilities) {
    updateConnectionStatus(facilities);
    els.list.innerHTML = facilities.map(renderFacility).join("");
  }

  async function fetchFacility(key, date, signal) {
    const response = await fetch(
      `/api/availability?date=${encodeURIComponent(date)}&provider=${encodeURIComponent(key)}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal
      }
    );

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // JSON이 아닌 오류 응답은 아래의 공통 메시지로 처리합니다.
    }

    if (!response.ok || payload?.ok === false) {
      const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }

    return normalizeFacility({
      connected: true,
      sessions: payload?.sessions || []
    }, key);
  }

  async function load() {
    const sequence = ++loadSequence;
    activeController?.abort();
    activeController = new AbortController();

    setLoading(true);
    setNotice("");
    setConnectionPending();
    els.time.textContent = "조회 중...";

    const date = validDate(els.date.value) ? els.date.value : readSelectedDate();
    els.date.value = date;
    saveSelectedDate(date);

    const state = { paradive: null, deepstation: null };
    const errors = {};
    renderState(state);

    const tasks = FACILITY_KEYS.map(async key => {
      try {
        const facility = await fetchFacility(key, date, activeController.signal);
        if (sequence !== loadSequence) return;
        state[key] = facility;
        delete errors[key];
      } catch (error) {
        if (error?.name === "AbortError" || sequence !== loadSequence) return;
        console.warn(`[DiveSpot] ${key} load failed`, error);
        const message = error?.message || "연결 실패";
        state[key] = normalizeFacility({
          connected: false,
          error: { message },
          sessions: []
        }, key);
        errors[key] = `${META[key].name}: ${message}`;
      }

      if (sequence !== loadSequence) return;
      updateConnectionStatus([state[key]]);
      renderState(state);
      setNotice(FACILITY_KEYS.map(item => errors[item]).filter(Boolean).join(" · "));
    });

    await Promise.allSettled(tasks);

    if (sequence !== loadSequence) return;
    const now = new Date();
    els.time.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())} 업데이트`;
    setLoading(false);
  }

  els.date.value = readSelectedDate();
  els.refresh.addEventListener("click", () => {
    saveSelectedDate(els.date.value);
    load();
  });
  els.date.addEventListener("change", () => {
    const selected = validDate(els.date.value) ? els.date.value : localDate(new Date());
    els.date.value = selected;
    saveSelectedDate(selected);
    load();
  });
  window.addEventListener("pagehide", () => saveSelectedDate(els.date.value));

  els.help.addEventListener("click", () => els.dialog.showModal());
  els.close.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", e => {
    if (e.target === els.dialog) els.dialog.close();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load, { once: true });
  } else {
    load();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js?v=9")
        .catch(error => console.warn("[DiveSpot] service worker registration failed", error));
    }, { once: true });
  }
})();
