<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DiveSpot 초기화</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Noto Sans KR",sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f7fd;color:#10234d;text-align:center}
    main{padding:28px}.spinner{width:34px;height:34px;border:4px solid #dbe5f4;border-top-color:#1559d8;border-radius:50%;margin:0 auto 16px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <main><div class="spinner"></div><strong>기존 화면 캐시를 초기화하고 있습니다.</strong><p>잠시 후 DiveSpot으로 이동합니다.</p></main>
  <script>
    (async () => {
      try {
        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(registration => registration.unregister()));
        }
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(key => caches.delete(key)));
        }
        localStorage.clear();
        sessionStorage.clear();
      } finally {
        location.replace("/?fresh=4");
      }
    })();
  </script>
</body>
</html>
