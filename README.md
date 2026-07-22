# DiveSpot

파라다이브와 딥스테이션의 프리다이빙 예약 가능 인원 및 부이 잔여석을 조회하는 웹앱입니다.

## Render 배포

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

파라다이브 조회에는 Render 환경변수 `PARADIVE_COOKIE`가 필요합니다.
딥스테이션은 공개 조회를 우선 사용하며, 사이트에서 세션을 요구할 경우 `DEEPSTATION_COOKIE`를 추가할 수 있습니다.

기존 서비스워커 캐시가 남아 있으면 배포 후 `/reset.html`을 한 번 열어 주세요.
