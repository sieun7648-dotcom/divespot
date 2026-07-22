# 부이체크 최종 배포본

파라다이브·딥스테이션의 날짜별 예약 가능 인원과 부이 현황을 확인하기 위한 모바일 PWA입니다.

## 현재 포함된 기능

- 파라다이브 / 딥스테이션 분리 화면
- 공식 사이트 로그인 버튼
- 로그인 완료 후 날짜별 조회 화면
- 1부~5부 예약 가능 인원
- 전반 부이 / 후반 부이 잔여 수량
- 전체 / 예약 가능 / 부이 가능 필터
- 예약페이지 바로가기
- iPhone 홈 화면 추가용 PWA
- 데모 모드
- 실데이터 연동용 Express API 구조
- Docker / Render 배포 설정

## 중요한 제한

일반 웹페이지는 다른 도메인인 파라다이브·딥스테이션의 로그인 쿠키를 읽을 수 없습니다.
따라서 지금 프로젝트는 바로 배포할 수 있지만, 실제 잔여수량은 아직 표시되지 않습니다.

실데이터를 연결하려면 다음 중 하나가 필요합니다.

1. 시설의 공식 API 또는 OAuth
2. Safari/Chrome 확장프로그램이 로그인된 예약페이지에서 데이터를 수집
3. 시설 예약페이지의 네트워크 요청을 분석한 뒤 안전한 인증 연결 구조 구축

SNS 아이디, 비밀번호, 로그인 쿠키를 서버에 평문으로 저장하면 안 됩니다.

## 로컬 실행

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000` 접속

## Render 배포

1. 이 폴더를 GitHub 저장소에 업로드
2. Render에서 Blueprint 또는 Web Service 생성
3. `render.yaml` 사용 또는 아래 설정 입력
   - Build Command: `npm install`
   - Start Command: `npm start`
4. 배포된 HTTPS 주소를 iPhone Safari에서 열기
5. 공유 → 홈 화면에 추가

## 실데이터 연결 위치

- `src/providers/paradive.js`
- `src/providers/deepstation.js`

각 파일의 `getAvailability()`가 아래 형식으로 세션 목록을 반환하면 화면에 표시됩니다.

```js
[
  {
    part: "1부",
    time: "08:00~11:00",
    people: 9,
    front: 3,
    back: 2
  }
]
```

## 데모 확인

앱에서 시설 로그인 흐름을 진행한 뒤 `데모 OFF`를 눌러 `데모 ON`으로 변경하고 조회하세요.
예시 수량으로 최종 디자인과 기능을 확인할 수 있습니다.
