# DiveSpot

파라다이브와 딥스테이션의 프리다이빙 예약 가능 인원 및 부이 잔여석을 조회하는 웹앱입니다.

## 현재 배포 구조

무료 Render 서버의 콜드 스타트 동안에도 화면이 즉시 보이도록 두 서비스로 분리했습니다.

- `divespot-site`: 사용자가 접속하는 Render Static Site
- `divespot`: 실제 예약정보를 조회하는 기존 Render Web Service

상세 배포 순서는 `DEPLOY_정적화면_설정방법.md`를 확인하세요.

## Web Service 환경변수

필수:

- `PARADIVE_COOKIE`
- `DEEPSTATION_ID`
- `DEEPSTATION_PASSWORD`

선택:

- `DEEPSTATION_CACHE_SECONDS`
- `DEEPSTATION_SESSION_SECONDS`
- `DEEPSTATION_ENTRY_TIMEOUT_SECONDS`
- `DEEPSTATION_USER_CHECK_TIMEOUT_SECONDS`
- `CORS_ALLOW_ORIGIN` — 기본값 `*`

## 프런트엔드 API 주소

`public/config.js`의 `apiBaseUrl`이 기존 Web Service 주소를 가리켜야 합니다.

```js
apiBaseUrl: "https://divespot.onrender.com"
```

## 진단 주소

- `/api/health`: 서버 상태 확인
- `/api/playwright-test`: Render 컨테이너에서 Chromium 실행 확인

기존 서비스워커가 남아 있다면 배포 후 정적 사이트의 `/reset.html`을 한 번 열어 초기화할 수 있습니다.
