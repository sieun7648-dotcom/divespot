# DiveSpot

파라다이브와 딥스테이션의 프리다이빙 예약 가능 인원 및 부이 잔여석을 조회하는 웹앱입니다.

## 현재 배포 구조

무료 Render 서버의 콜드 스타트 동안에도 화면이 즉시 보이도록 두 서비스로 분리했습니다.

- `divespot-site`: 사용자가 접속하는 Render Static Site
- `divespot`: 실제 예약정보를 조회하는 기존 Render Web Service

정적 화면은 날짜별 마지막 정상 조회 결과와 조회 시각을 브라우저에 저장합니다.
재접속하거나 날짜를 다시 선택하면 저장된 결과를 즉시 표시하고, 최신 결과는 화면을
막지 않은 채 백그라운드에서 갱신합니다.

## Render Static Site 생성값

GitHub 저장소 전체가 DiveSpot 프로젝트인 경우 다음 값을 그대로 입력합니다.

- **Root Directory**: `.` (입력란을 비워도 같은 의미)
- **Build Command**: `echo "DiveSpot static frontend ready"`
- **Publish Directory**: `public`

Static Site 이름을 `divespot-site`로 만들면 기본 주소는
`https://divespot-site.onrender.com`입니다. 이름이나 커스텀 도메인이 다르면 아래
`CORS_ALLOW_ORIGIN`도 실제 정적 사이트 주소로 바꿔야 합니다.

## Web Service 환경변수

필수:

- `PARADIVE_COOKIE`
- `DEEPSTATION_ID`
- `DEEPSTATION_PASSWORD`
- `CORS_ALLOW_ORIGIN` — `https://divespot-site.onrender.com` (끝 `/` 없이 실제 Static Site 주소)

선택:

- `AVAILABILITY_CACHE_SECONDS=300`
- `DEEPSTATION_CACHE_SECONDS=300`
- `DEEPSTATION_SESSION_SECONDS=21600`
- `DEEPSTATION_ENTRY_TIMEOUT_SECONDS=8`
- `DEEPSTATION_USER_CHECK_TIMEOUT_SECONDS=25`
- `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`

Web Service는 Docker 런타임, 무료 플랜, Dockerfile 경로 `./Dockerfile`,
Health Check 경로 `/api/health`를 사용합니다. `render.yaml`로 Blueprint 배포하면
Static Site와 Web Service가 함께 구성됩니다.

## 프런트엔드 API 주소

`public/config.js`의 `apiBaseUrl`이 기존 Web Service 주소를 가리켜야 합니다.

```js
apiBaseUrl: "https://divespot.onrender.com"
```

## 진단 주소

- `/api/health`: 서버 상태 확인
- `/api/playwright-test`: Render 컨테이너에서 Chromium 실행 확인

기존 서비스워커가 남아 있다면 배포 후 정적 사이트의 `/reset.html`을 한 번 열어 초기화할 수 있습니다.

## 캐시와 중복 조회

- 브라우저: 날짜별 마지막 정상 응답을 만료 없이 보관해 다음 접속 때 즉시 표시
- API 서버: 날짜별 전체 결과를 5분간 메모리 캐시
- 공급자: 같은 날짜의 진행 중 요청을 공유하여 Playwright 및 원본 사이트 중복 조회 방지
- DeepStation: 서버가 살아 있는 동안 Chromium, 브라우저 컨텍스트, 로그인 세션 재사용

메모리 캐시는 무료 Web Service가 다시 잠들거나 재시작되면 초기화되지만, 사용자의
브라우저에 저장된 마지막 정상 결과는 유지됩니다.
