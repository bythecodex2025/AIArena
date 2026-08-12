import test from "node:test";
import assert from "node:assert/strict";
import { initialState } from "../engine.js";
import {
  CUSTOM_AI_LIMITS,
  findLegalCustomMove,
  makePublicState,
  validateCustomCode,
  validateCustomFileMetadata,
} from "../custom-ai-runner.js";

test("사용자 AI에 전달하는 초기 공개 상태는 합법 수 4개를 포함한다", () => {
  const state = initialState();
  const publicState = makePublicState(state);
  assert.equal(publicState.legalMoves.length, 4);
  assert.notEqual(publicState.board, state.board);
  assert.notEqual(publicState.hands.P1, state.hands.P1);
});

test("사용자 AI가 반환한 수는 엔진 합법 수와 대조한다", () => {
  const state = initialState();
  const legal = makePublicState(state).legalMoves[0];
  assert.deepEqual(findLegalCustomMove(state, legal), legal);
  assert.equal(findLegalCustomMove(state, { type: "move", from: 0, to: 11 }), null);
});

test("chooseMove가 없는 코드와 50KB 초과 코드를 거부한다", () => {
  assert.throws(() => validateCustomCode("const answer = 1;"), /chooseMove/);
  const oversized = `function chooseMove(){return null;}/*${"x".repeat(CUSTOM_AI_LIMITS.codeBytes)}*/`;
  assert.throws(() => validateCustomCode(oversized), /50KB/);
});

test("AI 파일은 js 또는 txt 확장자와 50KB 용량 제한을 검사한다", () => {
  assert.equal(validateCustomFileMetadata({ name: "my-ai.js", size: 128 }), true);
  assert.equal(validateCustomFileMetadata({ name: "my-ai.TXT", size: 128 }), true);
  assert.throws(() => validateCustomFileMetadata({ name: "my-ai.html", size: 128 }), /\.js 또는 \.txt/);
  assert.throws(() => validateCustomFileMetadata({ name: "my-ai.js", size: 0 }), /비어/);
  assert.throws(() => validateCustomFileMetadata({ name: "my-ai.js", size: CUSTOM_AI_LIMITS.codeBytes + 1 }), /50KB/);
});
