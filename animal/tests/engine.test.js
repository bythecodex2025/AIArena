import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMove,
  assertValidState,
  initialState,
  legalMoves,
  piece,
  stateKey,
} from "../engine.js";

function emptyState(turn = "P1") {
  return {
    board: Array(12).fill(null),
    hands: { P1: { chick: 0, elephant: 0, giraffe: 0 }, P2: { chick: 0, elephant: 0, giraffe: 0 } },
    turn,
    ply: 0,
    pendingTry: null,
    winner: null,
    reason: null,
  };
}

test("초기 배치는 유효하며 첫 합법 수가 4개다", () => {
  const state = initialState();
  assert.equal(assertValidState(state), true);
  assert.equal(legalMoves(state).length, 4);
});

test("병아리는 이동해서 끝줄에 닿을 때 닭으로 승격한다", () => {
  const state = emptyState();
  state.board[10] = piece("P1", "lion");
  state.board[1] = piece("P2", "lion");
  state.board[3] = piece("P1", "chick");
  const next = applyMove(state, { type: "move", from: 3, to: 0 });
  assert.equal(next.board[0].type, "hen");
});

test("잡힌 닭은 병아리로 돌아가 잡은 말에 들어간다", () => {
  const state = emptyState();
  state.board[10] = piece("P1", "lion");
  state.board[1] = piece("P2", "lion");
  state.board[4] = piece("P1", "giraffe");
  state.board[7] = piece("P2", "hen");
  const next = applyMove(state, { type: "move", from: 4, to: 7 });
  assert.equal(next.hands.P1.chick, 1);
  assert.equal(next.board[7].type, "giraffe");
});

test("병아리는 움직일 곳이 없는 상대 끝줄에도 놓을 수 있다", () => {
  const state = emptyState();
  state.board[10] = piece("P1", "lion");
  state.board[2] = piece("P2", "lion");
  state.hands.P1.chick = 1;
  const drop = legalMoves(state).find((move) => move.type === "drop" && move.piece === "chick" && move.to === 0);
  assert.ok(drop);
  const next = applyMove(state, drop);
  assert.equal(next.board[0].type, "chick");
});

test("잡힐 수 없는 트라이는 즉시 승리로 확정된다", () => {
  const state = emptyState();
  state.board[3] = piece("P1", "lion");
  state.board[11] = piece("P2", "lion");
  const next = applyMove(state, { type: "move", from: 3, to: 0 });
  assert.equal(next.winner, "P1");
  assert.match(next.reason, /트라이/);
});

test("잡을 수 있는 트라이는 상대에게 한 번의 포획 기회를 준다", () => {
  const state = emptyState();
  state.board[3] = piece("P1", "lion");
  state.board[1] = piece("P2", "lion");
  state.board[6] = piece("P2", "giraffe");
  const tried = applyMove(state, { type: "move", from: 3, to: 0 });
  assert.equal(tried.winner, null);
  assert.equal(tried.pendingTry, "P1");
  const ignored = applyMove(tried, { type: "move", from: 6, to: 7 });
  assert.equal(ignored.winner, "P1");
});

test("라이온 포획은 즉시 대국을 끝낸다", () => {
  const state = emptyState();
  state.board[4] = piece("P1", "lion");
  state.board[1] = piece("P2", "lion");
  const next = applyMove(state, { type: "move", from: 4, to: 1 });
  assert.equal(next.winner, "P1");
  assert.equal(legalMoves(next).length, 0);
});

test("상태 키에는 차례와 잡은 말 정보가 포함된다", () => {
  const first = initialState();
  const second = initialState();
  second.turn = "P2";
  assert.notEqual(stateKey(first), stateKey(second));
  second.turn = "P1";
  second.hands.P1.chick = 1;
  assert.notEqual(stateKey(first), stateKey(second));
});

