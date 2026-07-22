
const providers = {
  paradive: {
    key: "paradive",
    name: "파라다이브",
    english: "PARADIVE",
    loginUrl: "https://paradive.co.kr/service/pc/page/reservation02.php",
    reserveUrl: "https://paradive.co.kr/service/pc/page/reservation02.php",
    times: ["08:00~11:00","11:00~14:00","14:00~17:00","17:00~20:00","20:00~23:00"]
  },
  deepstation: {
    key: "deepstation",
    name: "딥스테이션",
    english: "DEEPSTATION",
    loginUrl: "https://deepstation.kr/",
    reserveUrl: "https://deepstation.kr/",
    times: ["운영시간 확인","운영시간 확인","운영시간 확인","운영시간 확인","운영시간 확인"]
  }
};

const demoData = {
  paradive: [
    {part:"1부", people:9, front:3, back:2},
    {part:"2부", people:4, front:1, back:0},
    {part:"3부", people:0, front:0, back:0},
    {part:"4부", people:7, front:2, back:2},
    {part:"5부", people:3, front:0, back:1}
  ],
  deepstation: [
    {part:"1부", people:6, front:2, back:1},
    {part:"2부", people:2, front:0, back:1},
    {part:"3부", people:8, front:3, back:3},
    {part:"4부", people:1, front:0, back:0},
    {part:"5부", people:0, front:0, back:0}
  ]
};

const state = {
  provider: "paradive",
  loggedIn: false,
  demo: false,
  filter: "all",
  rows: []
};

const $ = (id) => document.getElementById(id);
const providerTabs = [...document.querySelectorAll(".provider-tab")];
const filterChips = [...document.querySelectorAll(".filter-chip")];

const dateInput = $("dateInput");
dateInput.value = new Date().toISOString().slice(0, 10);

function provider() {
  return providers[state.provider];
}

function switchProvider(key) {
  state.provider = key;
  state.loggedIn = false;
  state.rows = [];
  providerTabs.forEach(tab => tab.classList.toggle("active", tab.dataset.provider === key));
  $("providerName").textContent = provider().name;
  $("loginButtonLabel").textContent = `${provider().name} 로그인`;
  $("loginBadge").className = "status-badge neutral";
  $("loginBadge").innerHTML = '<span class="pulse"></span> 로그인 필요';
  $("loginCompleteBtn").classList.add("hidden");
  $("lookupCard").classList.add("hidden");
  $("resultsSection").classList.add("hidden");
  $("errorState").classList.add("hidden");
}

providerTabs.forEach(tab => tab.addEventListener("click", () => switchProvider(tab.dataset.provider)));

$("openLoginBtn").addEventListener("click", () => {
  window.open(provider().loginUrl, "_blank", "noopener");
  $("loginCompleteBtn").classList.remove("hidden");
});

$("loginCompleteBtn").addEventListener("click", () => {
  state.loggedIn = true;
  $("loginBadge").className = "status-badge success";
  $("loginBadge").innerHTML = '<span class="pulse"></span> 로그인 완료';
  $("loginCompleteBtn").classList.add("hidden");
  $("lookupCard").classList.remove("hidden");
  $("lookupCard").scrollIntoView({behavior:"smooth", block:"start"});
});

$("demoToggle").addEventListener("click", () => {
  state.demo = !state.demo;
  $("demoToggle").classList.toggle("on", state.demo);
  $("demoToggle").textContent = state.demo ? "데모 ON" : "데모 OFF";
  $("demoToggle").setAttribute("aria-pressed", String(state.demo));
  $("lookupHint").textContent = state.demo
    ? "현재 예시 데이터로 화면을 확인하고 있습니다."
    : "실데이터 연결 전에는 데모 모드를 켜서 화면을 확인할 수 있습니다.";
});

$("refreshBtn").addEventListener("click", loadAvailability);

async function loadAvailability() {
  $("errorState").classList.add("hidden");
  $("resultsSection").classList.add("hidden");
  $("loadingState").classList.remove("hidden");

  try {
    await new Promise(resolve => setTimeout(resolve, 650));

    if (state.demo) {
      state.rows = demoData[state.provider].map((row, i) => ({
        ...row,
        time: provider().times[i]
      }));
      renderResults();
      return;
    }

    const params = new URLSearchParams({
      provider: state.provider,
      date: dateInput.value
    });
    const response = await fetch(`/api/availability?${params.toString()}`, {
      headers: {"Accept":"application/json"}
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.message || "예약 현황을 불러오지 못했습니다.");
    }

    state.rows = data.sessions;
    renderResults();
  } catch (error) {
    $("errorTitle").textContent = "실데이터 연결이 필요합니다";
    $("errorText").textContent = error.message + " 데모 모드를 켜면 완성된 화면을 확인할 수 있습니다.";
    $("errorState").classList.remove("hidden");
  } finally {
    $("loadingState").classList.add("hidden");
  }
}

function renderResults() {
  const date = new Date(`${dateInput.value}T00:00:00`);
  $("resultProvider").textContent = provider().english;
  $("resultDate").textContent = date.toLocaleDateString("ko-KR", {
    month:"long", day:"numeric", weekday:"short"
  });

  const people = state.rows.reduce((sum, row) => sum + Number(row.people || 0), 0);
  const front = state.rows.reduce((sum, row) => sum + Number(row.front || 0), 0);
  const back = state.rows.reduce((sum, row) => sum + Number(row.back || 0), 0);

  $("sumPeople").innerHTML = `${people}<small>명</small>`;
  $("sumFront").innerHTML = `${front}<small>자리</small>`;
  $("sumBack").innerHTML = `${back}<small>자리</small>`;
  $("updatedAt").textContent = new Date().toLocaleTimeString("ko-KR", {hour:"2-digit", minute:"2-digit"}) + " 업데이트";

  renderSessions();
  $("resultsSection").classList.remove("hidden");
  $("resultsSection").scrollIntoView({behavior:"smooth", block:"start"});
}

function renderSessions() {
  const filtered = state.rows.filter(row => {
    if (state.filter === "available") return Number(row.people) > 0;
    if (state.filter === "buoy") return Number(row.front) > 0 || Number(row.back) > 0;
    return true;
  });

  $("sessionList").innerHTML = filtered.map(row => {
    const people = Number(row.people || 0);
    const front = Number(row.front || 0);
    const back = Number(row.back || 0);
    const countClass = people === 0 ? "closed" : people <= 3 ? "low" : "";
    return `
      <article class="session-card">
        <div class="session-top">
          <div>
            <div class="part">${row.part}</div>
            <div class="time">${row.time || ""}</div>
          </div>
          <div class="people-count ${countClass}">
            <strong>${people === 0 ? "마감" : people + "명"}</strong>
            <span>추가 예약 가능</span>
          </div>
        </div>
        <div class="buoy-grid">
          <div class="buoy-box">
            <span>35M 부이 전반</span>
            <strong class="${front > 0 ? "ok" : "no"}">${front > 0 ? front + "자리" : "마감"}</strong>
          </div>
          <div class="buoy-box">
            <span>35M 부이 후반</span>
            <strong class="${back > 0 ? "ok" : "no"}">${back > 0 ? back + "자리" : "마감"}</strong>
          </div>
        </div>
        <button type="button" class="reserve-btn" data-part="${row.part}">${row.part} 예약페이지로 이동</button>
      </article>
    `;
  }).join("") || `<div class="message-card"><div class="message-icon">i</div><div><strong>조건에 맞는 시간이 없습니다</strong><p>다른 필터를 선택해 보세요.</p></div></div>`;

  document.querySelectorAll(".reserve-btn").forEach(button => {
    button.addEventListener("click", () => {
      window.open(provider().reserveUrl, "_blank", "noopener");
    });
  });
}

filterChips.forEach(chip => chip.addEventListener("click", () => {
  state.filter = chip.dataset.filter;
  filterChips.forEach(item => item.classList.toggle("active", item === chip));
  renderSessions();
}));

let deferredPrompt;
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredPrompt = event;
  $("installBtn").classList.remove("hidden");
});
$("installBtn").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("installBtn").classList.add("hidden");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
