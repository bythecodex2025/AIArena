import test from "node:test";
import assert from "node:assert/strict";
import { chooseMove, installTablebase, tablebaseSize } from "../ai.js";
import { piece } from "../engine.js";
import { solveExhaustively } from "../exhaustive-solver.js";

function winningPosition() {
  const board = Array(12).fill(null);
  board[4] = piece("P1", "lion");
  board[1] = piece("P2", "lion");
  return {
    board,
    hands: { P1: { chick: 0, elephant: 0, giraffe: 0 }, P2: { chick: 0, elephant: 0, giraffe: 0 } },
    turn: "P1", ply: 0, pendingTry: null, winner: null, reason: null,
  };
}

for (const level of ["v2", "v3", "v4", "v5"]) {
  test(`${level}는 즉시 라이온을 잡는 수를 선택한다`, () => {
    const answer = chooseMove(winningPosition(), level, { timeMs: 40, maxDepth: 6 });
    assert.deepEqual(answer.move, { type: "move", from: 4, to: 1 });
    assert.ok(answer.stats.nodes > 0);
  });
}

test("v1은 주입한 난수로 재현 가능한 수를 고른다", () => {
  const answer = chooseMove(winningPosition(), "v1", { random: () => 0 });
  assert.ok(answer.move);
  assert.equal(answer.stats.source, "random");
});

test("작은 종료 가능 그래프를 후퇴 분석으로 정확히 푼다", () => {
  const solved = solveExhaustively(winningPosition(), { maxStates: 100 });
  assert.equal(solved.complete, true);
  assert.equal(solved.outcome.outcome, 1);
  assert.equal(solved.outcome.dtm, 1);
  assert.equal(solved.stateCount, 2);
});

test("상태 한도에 도달하면 불완전 결과를 정확해로 저장하지 않는다", () => {
  const state = winningPosition();
  state.board[7] = piece("P1", "giraffe");
  const solved = solveExhaustively(state, { maxStates: 1 });
  assert.equal(solved.complete, false);
  assert.match(solved.reason, /한도/);
});

test("v5는 설치된 정확 테이블베이스를 탐색보다 먼저 사용한다", () => {
  const state = winningPosition();
  const solved = solveExhaustively(state, { maxStates: 100 });
  installTablebase(solved.entries);
  const answer = chooseMove(state, "v5", { timeMs: 20 });
  assert.equal(tablebaseSize(), 2);
  assert.equal(answer.stats.exact, true);
  assert.equal(answer.stats.source, "tablebase");
  assert.deepEqual(answer.move, { type: "move", from: 4, to: 1 });
  installTablebase(null);
});
