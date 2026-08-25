import test from "node:test";
import assert from "node:assert/strict";
import { findLegalCustomAction, makePublicState, validateCustomCode, validateCustomFileMetadata } from "../custom-ai-runner.js";
import { initialState } from "../engine.js";

test("공개 상태는 미래 덱 없이 합법 행동을 제공한다", () => {
  const view = makePublicState(initialState());
  assert.ok(view.legalActions.length > 0);
  assert.equal("deck" in view, false);
  assert.equal(view.gameId, "starlight-auction");
});

test("사용자 AI 반환값을 현재 합법 행동 ID와 대조한다", () => {
  const state = initialState();
  const id = makePublicState(state).legalActions[0].id;
  assert.equal(findLegalCustomAction(state, id)?.id, id);
  assert.equal(findLegalCustomAction(state, { id })?.id, id);
  assert.equal(findLegalCustomAction(state, "bid:999"), null);
});

test("함수·파일 형식·50KB 제한을 검사한다", () => {
  assert.equal(validateCustomCode("function chooseAction(state, me) { return state.legalActions[0]; }"), true);
  assert.throws(() => validateCustomCode("function nope() {}"), /chooseAction/);
  assert.throws(() => validateCustomCode(`function chooseAction(){return "pass";}/*${"x".repeat(50_001)}*/`), /50KB/);
  assert.equal(validateCustomFileMetadata({ name: "auction.js", size: 100 }), true);
  assert.throws(() => validateCustomFileMetadata({ name: "auction.py", size: 100 }), /js 또는 .txt/);
});
