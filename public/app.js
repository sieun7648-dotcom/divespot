(() => {
  "use strict";

  const META = {
    paradive: {
      name: "PARADIVE",
      subtitle: "파라다이브 예약 현황",
      url: "https://paradive.co.kr/service/pc/page/reservation02.php"
    },
    deepstation: {
      name: "DEEP STATION",
      subtitle: "딥스테이션 예약 현황",
      url: "https://deepstation.kr/"
    }
  };

  const DEMO = {
    paradive: {
      sessions: [
        { part: "1부", time: "08:00 ~ 11:00", people: 9, front: 3, back: 2 },
        { part: "2부", time: "11:00 ~ 14:00", people: 4, front: 1, back: 0 },
        { part: "3부", time: "14:00 ~ 17:00", people: 0, front: 0, back: 0 },
        { part: "4부", time: "17:00 ~ 20:00", people: 7, front: 2, back: 2 },
        { part: "5부", time: "20:00 ~ 23:00", people: 3, front: 0, back: 1 }
      ]
    },
    deepstation: {
      sessions: [
        { part: "1부", time: "08:00 ~ 11:00", people: 6, front: 2, back: 1 },
        { part: "2부", time: "11:00 ~ 14:00", people: 2, front: 0, back: 1 },
        { part: "3부", time: "14:00 ~ 17:00", people: 8, front: 3, back: 3 },
        { part: "4부", time: "17:00 ~ 20:00", people: 1, front: 0, back: 0 },
        { part: "5부", time: "20:00 ~ 23:00", people: 0, front: 0, back: 0 }
      ]
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
    close: document.querySelector("#closeHelpButton")
  };

  let loading = false;

  const pad = n => String(n).padStart(2, "0");
  const localDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

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
        <td><span class="value ${statusClass(s.front)}">${display(s.front, "자리")}</span></td>
        <td><span class="value ${statusClass(s.back)}">${display(s.back, "자리")}</span></td>
      </tr>
    `).join("");

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
            <strong>${sum.front}</strong><small>자리</small>
          </div>
          <div class="hero-stat">
            <span>후반 부이</span>
            <strong>${sum.back}</strong><small>자리</small>
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
            <tbody>${rows || '<tr><td colspan="5">조회 데이터가 없습니다.</td></tr>'}</tbody>
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

  function renderLoading() {
    els.list.innerHTML = `
      <div class="facility-card skeleton"></div>
      <div class="facility-card skeleton"></div>
    `;
  }

  function render(facilities) {
    els.list.innerHTML = facilities.map(renderFacility).join("");
  }

  async function load() {
    if (loading) return;
    setLoading(true);
    setNotice("");
    renderLoading();

    const date = els.date.value || localDate(new Date());

    try {
      const response = await fetch(`/api/availability?date=${encodeURIComponent(date)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const facilities = normalize(await response.json());

      if (!facilities.some(x => x.sessions.length)) {
        throw new Error("empty data");
      }

      render(facilities);
    } catch (error) {
      console.warn("[DiveSpot] demo mode", error);
      setNotice("현재 실시간 연동 전이라 예시 데이터가 표시되고 있습니다.");
      render([
        normalizeFacility(DEMO.paradive, "paradive"),
        normalizeFacility(DEMO.deepstation, "deepstation")
      ]);
    } finally {
      const now = new Date();
      els.time.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())} 업데이트`;
      setLoading(false);
    }
  }

  els.date.value = localDate(new Date());
  els.refresh.addEventListener("click", load);
  els.date.addEventListener("change", load);

  els.help.addEventListener("click", () => els.dialog.showModal());
  els.close.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", e => {
    if (e.target === els.dialog) els.dialog.close();
  });

  document.addEventListener("DOMContentLoaded", load);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  }
})();
