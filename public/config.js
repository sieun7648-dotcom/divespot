"use strict";

// 화면(정적 사이트)과 조회 서버(Render Web Service)를 분리하기 위한 설정입니다.
// 기존 조회 서버 주소가 바뀌면 아래 apiBaseUrl만 수정하세요.
window.DIVESPOT_CONFIG = Object.freeze({
  apiBaseUrl: "https://divespot.onrender.com",
  backendStartupTimeoutMs: 90000,
  requestTimeoutMs: 45000
});
