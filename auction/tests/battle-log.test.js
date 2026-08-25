import test from "node:test";
import assert from "node:assert/strict";
import { battleLogFilename, fairSideSchedule, formatBattleLog } from "../battle-log.js";

const sample = {
  rulesVersion: "1.0.0", sequence: 1, seed: 77, opponent: "v2", opponentName: "가치 계산가", customSide: "P1",
  codeFileName: "my-ai.js", result: "win", reason: "8개 경매 종료", plies: 31, timeoutMs: 500, maxPlies: 96, error: null,
  actions: [{ ply: 1, side: "P1", actor: "내 AI", text: "세트 수집가 선택", elapsedMs: 2.1, credits: 22, favor: 2, score: 7 }],
};

test("로그는 시드·행동 자원·종료 사유를 포함한다", () => {
  const text = formatBattleLog(sample);
  assert.match(text, /시드 77/);
  assert.match(text, /C 22 · F 2 · SCORE 7/);
  assert.match(text, /8개 경매 종료/);
});

test("파일명과 공정 진영 일정을 만든다", () => {
  assert.equal(battleLogFilename(sample), "starlight-auction-v2-77-game-01-win.txt");
  assert.deepEqual(fairSideSchedule(4), ["P1", "P2", "P1", "P2"]);
  assert.throws(() => fairSideSchedule(3), /짝수/);
});
