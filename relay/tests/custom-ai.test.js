import test from "node:test";
import assert from "node:assert/strict";
import {
  findLegalCustomAction,
  makePublicState,
  validateCustomCode,
  validateCustomFileMetadata,
} from "../custom-ai-runner.js";
import { initialState } from "../engine.js";

test("공개 상태에는 내부 반복 정보 없이 합법 행동이 제공된다", () => {
  const view = makePublicState(initialState());
  assert.ok(view.legalActions.length > 0);
  assert.equal("repetitions" in view, false);
  assert.equal(view.nodes.every((item) => "powered" in item), true);
});

test("사용자 AI 반환값은 행동 ID로 현재 합법 행동과 대조한다", () => {
  const state = initialState();
  const id = makePublicState(state).legalActions[0].id;
  assert.equal(findLegalCustomAction(state, id)?.id, id);
  assert.equal(findLegalCustomAction(state, { id })?.id, id);
  assert.equal(findLegalCustomAction(state, "extend:99"), null);
});

test("필수 함수와 50KB 코드 제한을 검사한다", () => {
  assert.equal(validateCustomCode("function chooseAction(state, me) { return state.legalActions[0]; }"), true);
  assert.throws(() => validateCustomCode("function nope() {}"), /chooseAction/);
  assert.throws(() => validateCustomCode(`function chooseAction(){return "wait";}/*${"x".repeat(50_001)}*/`), /50KB/);
});

test("AI 파일은 js 또는 txt 확장자와 용량을 검사한다", () => {
  assert.equal(validateCustomFileMetadata({ name: "relay.js", size: 100 }), true);
  assert.equal(validateCustomFileMetadata({ name: "relay.txt", size: 100 }), true);
  assert.throws(() => validateCustomFileMetadata({ name: "relay.py", size: 100 }), /js 또는 .txt/);
  assert.throws(() => validateCustomFileMetadata({ name: "relay.js", size: 50_001 }), /50KB/);
});
