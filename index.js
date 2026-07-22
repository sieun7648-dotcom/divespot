<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#f4f7fd" />
  <meta name="description" content="파라다이브와 딥스테이션 예약 현황" />
  <title>DiveSpot</title>
  <link rel="manifest" href="/manifest.webmanifest?v=4" />
  <link rel="stylesheet" href="/style.css?v=4" />
</head>
<body>
  <main class="app">
    <header class="topbar">
      <div>
        <h1>DiveSpot</h1>
        <p>실시간 다이빙 예약 현황</p>
      </div>
      <div class="top-actions">
        <button id="themeButton" class="circle-button" type="button" aria-label="화면 밝기">☼</button>
        <button id="helpButton" class="help-button" type="button"><span>?</span> 사용 방법</button>
      </div>
    </header>

    <section class="control-row">
      <label class="date-box">
        <span class="calendar-icon">▣</span>
        <input id="dateInput" type="date" />
      </label>
      <button id="refreshButton" class="refresh-button" type="button">
        <span class="refresh-symbol">↻</span> 전체 새로고침
      </button>
    </section>

    <section class="login-panel">
      <strong>연결 상태</strong>
      <div class="login-divider"></div>
      <div class="login-item">
        <span id="paradiveStatusIcon" class="login-check para">✓</span>
        <span><small>파라다이브</small><b id="paradiveStatusText">확인 중</b></span>
      </div>
      <div class="login-divider"></div>
      <div class="login-item">
        <span id="deepstationStatusIcon" class="login-check deep">✓</span>
        <span><small>딥스테이션</small><b id="deepstationStatusText">확인 중</b></span>
      </div>
      <div class="update-time" id="updateTime">--:-- 업데이트</div>
    </section>

    <section id="notice" class="notice" hidden></section>
    <section id="facilityList" class="facility-list" aria-live="polite"></section>

    <footer class="footer">
      <div class="footer-note">ⓘ 잔여 인원 및 부이 정보는 실제 예약페이지 기준으로 안내됩니다.</div>
      <div class="footer-brand">Made by <strong>SIEUN</strong></div>
    </footer>
  </main>

  <dialog id="helpDialog" class="help-dialog">
    <div class="help-card">
      <div class="help-head">
        <h2>사용 방법</h2>
        <button id="closeHelpButton" type="button">×</button>
      </div>
      <ol>
        <li>조회할 날짜를 선택합니다.</li>
        <li>시설별 잔여 인원과 부이 현황을 확인합니다.</li>
        <li>예약은 각 시설의 공식 예약페이지에서 진행합니다.</li>
      </ol>
    </div>
  </dialog>

  <script src="/app.js?v=4" defer></script>
</body>
</html>
