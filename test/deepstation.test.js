"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDayInfoPath,
  normalizeSessions
} = require("../src/providers/deepstation");

test("딥스테이션 동일 출처 요청 query를 정확히 구성한다", () => {
  const path = buildDayInfoPath("2026-07-22");
  const url = new URL(path, "https://deepstation.kr");

  assert.equal(url.pathname, "/rez/ajax.dayinfo.php");
  assert.deepEqual([...url.searchParams.entries()], [
    ["date", "2026-07-22"],
    ["rez_id", "undefined"],
    ["rtype", "프리다이빙"]
  ]);
});

test("remain.gen을 사용자 화면 세션 형식으로 변환한다", () => {
  const sessions = normalizeSessions({
    remain: {
      gen: [
        { stime: "09:00", etime: "12:00", remain: "17" },
        { stime: "13:00", etime: "16:00", remain: 4 }
      ]
    },
    remain_buoys: [
      { stime: "09:00", etime: "10:30", remain_buoys: "2" },
      { stime: "10:30", etime: "12:00", remain_buoys: 1 },
      { stime: "13:00", etime: "14:30", remain_buoys: 0 },
      { stime: "14:30", etime: "16:00", remain_buoys: "3" }
    ]
  });

  assert.deepEqual(sessions, [
    { part: "1부", time: "09:00 ~ 12:00", people: 17, front: 2, back: 1 },
    { part: "2부", time: "13:00 ~ 16:00", people: 4, front: 0, back: 3 }
  ]);
});
