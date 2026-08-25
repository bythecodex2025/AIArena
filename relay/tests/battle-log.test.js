import test from "node:test";
import assert from "node:assert/strict";
import { battleLogFilename, fairSideSchedule, formatBattleLog } from "../battle-log.js";

const sample = {
  rulesVersion: "1.2.0",
  sequence: 1,
  opponent: "v2",
  opponentName: "v2 릴레이 기사",
  customSide: "P1",
  codeFileName: "my-ai.js",
  result: "win",
  reason: "P2 코어를 해킹했습니다.",
  plies: 17,
  timeoutMs: 500,
  maxPlies: 48,
  playedAt: "2026. 8. 13. 12:00:00",
  error: null,
  actions: [
    { ply: 1, side: "P1", actor: "내 AI", text: "연결 B4", elapsedMs: 3.2, energy: 2, relays: 0, score: 0 },
  ],
};

test("대전 로그는 규칙 버전, 행동 계측과 종료 사유를 포함한다", () => {
  const text = formatBattleLog(sample);
  assert.match(text, /relay-forge \/ 1\.2\.0/);
  assert.match(text, /연결 B4 · 3\.2ms · E 2 · R 0 · SCORE 0/);
  assert.match(text, /P2 코어를 해킹/);
});

test("로그 파일명은 경기별로 구분된다", () => {
  assert.equal(battleLogFilename(sample), "relay-forge-v2-game-01-win.txt");
});

test("공정 대전 일정은 양 진영을 같은 횟수로 배정한다", () => {
  assert.deepEqual(fairSideSchedule(4), ["P1", "P2", "P1", "P2"]);
  assert.throws(() => fairSideSchedule(3), /짝수/);
});
