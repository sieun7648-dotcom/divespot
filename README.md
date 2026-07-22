# DiveSpot 실데이터 테스트 버전

파라다이브와 딥스테이션의 날짜별 예약 현황을 비교하는 모바일 PWA입니다.
현재 파라다이브는 로그인 세션 쿠키를 Render 환경변수로 연결해 실데이터 조회를 시험할 수 있고, 딥스테이션은 아직 연결 준비 상태입니다.

## Render 환경변수

Render Dashboard → DiveSpot 서비스 → Environment에서 아래 값을 추가합니다.

- `PARADIVE_COOKIE` (필수): 로그인 후 브라우저 요청의 Cookie 헤더 값
- `PARADIVE_MAX_PEOPLE` (선택, 기본 40): 최대 인원 탐색 상한
- `PARADIVE_CACHE_SECONDS` (선택, 기본 300): 같은 날짜 결과 캐시 시간
- `PARADIVE_EXERCISE_SELECT` (선택, 기본 2)
- `PARADIVE_USE_TIME` (선택, 기본 2)

주의: 쿠키는 GitHub 코드나 채팅에 넣지 마세요. 세션이 만료되면 Render의 `PARADIVE_COOKIE`만 새 값으로 바꿔야 합니다.

## 동작 방식

- `op=stock` 요청으로 각 부의 예약 가능한 최대 인원을 이진 탐색합니다.
- `op=select` 요청으로 전반/후반 부이 선택 가능 여부를 각각 확인합니다.
- 부이는 현재 API가 수량을 주지 않으므로 `1자리 가능` 또는 `마감`으로 표시합니다.
- 같은 날짜는 기본 5분간 캐시해 파라다이브 요청 횟수를 줄입니다.

## 로컬 실행

```bash
npm install
PARADIVE_COOKIE='PHPSESSID=...' npm start
```

Windows PowerShell:

```powershell
$env:PARADIVE_COOKIE="PHPSESSID=..."
npm start
```

## 주의

이 버전은 확인된 비공식 웹 요청을 재현하는 시험 구현입니다. 사이트 구조, 로그인 방식 또는 운영 정책이 바뀌면 동작하지 않을 수 있습니다. 자동 조회 빈도를 높이지 말고 개인적인 확인 용도로 제한하세요.
