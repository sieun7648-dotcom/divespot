<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0d2859" />
  <meta name="description" content="안드로이드에 DiveSpot 설치하기" />
  <title>DiveSpot 안드로이드 설치</title>
  <link rel="manifest" href="/manifest.webmanifest?v=9" />
  <link rel="icon" href="/icons/icon-192.png" type="image/png" />
  <style>
    :root{--navy:#0d2859;--blue:#1559d8;--bg:#f4f7fd;--muted:#71809f;--line:#e2e8f2}
    *{box-sizing:border-box} body{margin:0;min-height:100vh;background:radial-gradient(circle at 10% 0%,rgba(63,122,255,.13),transparent 26rem),var(--bg);font-family:-apple-system,BlinkMacSystemFont,"Noto Sans KR","Segoe UI",sans-serif;color:var(--navy)}
    main{width:min(520px,calc(100% - 32px));margin:0 auto;padding:max(30px,env(safe-area-inset-top)) 0 max(34px,env(safe-area-inset-bottom))}
    .brand{display:flex;align-items:center;gap:14px;margin:8px 0 26px}.brand img{width:58px;height:58px;border-radius:17px;box-shadow:0 12px 28px rgba(13,40,89,.18)}.brand h1{margin:0;font-size:27px}.brand p{margin:4px 0 0;color:var(--muted);font-size:13px;font-weight:700}
    .card{background:#fff;border:1px solid rgba(255,255,255,.9);border-radius:25px;padding:25px;box-shadow:0 18px 45px rgba(29,55,100,.11)}
    .tag{display:inline-flex;padding:7px 10px;border-radius:999px;background:#eaf1ff;color:var(--blue);font-size:11px;font-weight:900}.card h2{margin:14px 0 9px;font-size:25px;line-height:1.3}.lead{margin:0 0 22px;color:var(--muted);font-size:14px;line-height:1.65}
    button,a.button{width:100%;min-height:54px;border:0;border-radius:16px;display:flex;align-items:center;justify-content:center;text-decoration:none;font-weight:900;font-size:15px}
    #installButton{background:linear-gradient(135deg,#0d2859,#1559d8);color:#fff;box-shadow:0 12px 24px rgba(21,89,216,.24)}
    a.button{margin-top:10px;background:#eef3fb;color:var(--navy)}
    .steps{margin:24px 0 0;padding:0;list-style:none;display:grid;gap:13px}.steps li{display:grid;grid-template-columns:31px 1fr;gap:11px;align-items:start;color:#364b73;font-size:14px;line-height:1.55}.num{width:31px;height:31px;border-radius:10px;background:#edf3ff;color:var(--blue);display:grid;place-items:center;font-weight:900}.note{margin:19px 0 0;padding:14px 15px;border-radius:14px;background:#f7f9fd;color:var(--muted);font-size:12px;line-height:1.55;border:1px solid var(--line)}
    .done{display:none;margin-bottom:16px;padding:13px;border-radius:14px;background:#e7f7ef;color:#14845a;font-weight:800;font-size:13px}.done.show{display:block}
  </style>
</head>
<body>
<main>
  <div class="brand"><img src="/icons/icon-192.png" alt="DiveSpot" /><div><h1>DiveSpot</h1><p>안드로이드 홈 화면 설치</p></div></div>
  <section class="card">
    <div id="installedMessage" class="done">이미 DiveSpot이 앱처럼 실행되고 있어요.</div>
    <span class="tag">ANDROID</span>
    <h2>홈 화면에 DiveSpot을 설치하세요</h2>
    <p class="lead">설치 후에는 주소창 없이 앱처럼 바로 열 수 있어요.</p>
    <button id="installButton" type="button">DiveSpot 설치하기</button>
    <a class="button" href="/">설치하지 않고 바로 열기</a>
    <ol class="steps">
      <li><span class="num">1</span><span>위의 <b>설치하기</b> 버튼을 누릅니다.</span></li>
      <li><span class="num">2</span><span>설치 창이 안 뜨면 Chrome 오른쪽 위 <b>⋮</b>를 누릅니다.</span></li>
      <li><span class="num">3</span><span><b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 선택합니다.</span></li>
    </ol>
    <p id="fallbackNote" class="note">설치 버튼이 바로 작동하지 않는 브라우저에서는 Chrome 메뉴의 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 이용해 주세요.</p>
  </section>
</main>
<script>
(() => {
  "use strict";
  let installPrompt = null;
  const button = document.querySelector("#installButton");
  const done = document.querySelector("#installedMessage");
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

  if (standalone) {
    done.classList.add("show");
    button.textContent = "DiveSpot 열기";
    button.addEventListener("click", () => location.href = "/");
  } else {
    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      installPrompt = event;
      button.textContent = "DiveSpot 설치하기";
    });

    button.addEventListener("click", async () => {
      if (!installPrompt) {
        alert("Chrome 오른쪽 위 ⋮ 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 눌러주세요.");
        return;
      }
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
    });
  }

  window.addEventListener("appinstalled", () => {
    done.classList.add("show");
    button.textContent = "설치 완료";
    button.disabled = true;
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js?v=9").catch(() => {});
  }
})();
</script>
</body>
</html>
