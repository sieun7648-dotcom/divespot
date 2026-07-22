# DiveSpot

파라다이브와 딥스테이션의 프리다이빙 예약 가능 인원 및 부이 잔여석을 조회하는 웹앱입니다.

## Render 배포

- Runtime: `Docker`
- Dockerfile Path: `./Dockerfile`
- Health Check Path: `/api/health`

파라다이브 조회에는 Render 환경변수 `PARADIVE_COOKIE`가 필요합니다.
딥스테이션 로그인에는 Render 환경변수 `DEEPSTATION_ID`, `DEEPSTATION_PASSWORD`가 필요합니다.
서버는 Playwright Chromium 로그인 세션을 기본 20분간 재사용하고, 날짜별 조회 결과를 기본 2분간 공유 캐시합니다.

배포 후 `GET /api/playwright-test`를 열면 Render 컨테이너에서 Chromium이 실제로 실행되는지 먼저 확인할 수 있습니다.
정상일 때 `ok: true`, Chromium 버전과 user agent를 반환합니다.

선택 환경변수:

- `DEEPSTATION_CACHE_SECONDS`: 조회 캐시 시간(기본 120초, 최소 30초)
- `DEEPSTATION_SESSION_SECONDS`: 로그인 세션 재사용 시간(기본 1200초, 최소 60초)
- `DEEPSTATION_TIMEOUT_SECONDS`: Chromium 동작 제한 시간(기본 25초, 최소 5초)

기존 서비스워커 캐시가 남아 있으면 배포 후 `/reset.html`을 한 번 열어 주세요.
