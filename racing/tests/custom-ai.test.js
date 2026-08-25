import test from "node:test";
import assert from "node:assert/strict";
import { findLegalAction, validateCustomCode } from "../custom-ai-runner.js";

test("chooseAction이 없는 코드를 거부한다", () => assert.throws(() => validateCustomCode("const nope = 1"), /chooseAction/));
test("행동은 합법 행동 ID로 다시 검증한다", () => {
  const actions = [{ id: "a" }, { id: "b" }];
  assert.equal(findLegalAction(actions, { id: "b" }), actions[1]);
  assert.equal(findLegalAction(actions, "warp"), null);
});
