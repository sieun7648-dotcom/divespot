
/**
 * 실데이터 연결 어댑터
 *
 * 이 파일에서 로그인 후 예약 페이지가 호출하는 네트워크 요청을 재현해야 합니다.
 * 일반 PWA는 다른 도메인의 로그인 쿠키를 직접 읽을 수 없으므로,
 * 다음 중 하나의 방식으로 구현해야 합니다.
 *
 * 1) 시설에서 공식 API/OAuth를 제공하는 경우 해당 API 사용
 * 2) Safari/Chrome 확장프로그램이 로그인된 페이지에서 데이터를 수집해 이 서버로 전달
 * 3) 사용자가 자신의 세션을 안전하게 연결하는 별도 인증 구조 구성
 *
 * 비밀번호나 SNS 계정 정보는 저장하지 마세요.
 */
async function getAvailability(date, req) {
  void date;
  void req;

  const error = new Error(
    "현재 실시간 예약 데이터 연결이 설정되지 않았습니다."
  );
  error.code = "PROVIDER_NOT_CONNECTED";
  error.statusCode = 501;
  throw error;
}

module.exports = { getAvailability };
