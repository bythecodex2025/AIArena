import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyActions, initialState, legalActions, outcome, publicState } from "../engine.js";
import { chooseAction as chooseBuiltIn } from "../ai.js";

const source = await readFile(new URL("../strong-ai.js", import.meta.url), "utf8");
const chooseStrong = new Function(`${source}\nreturn chooseAction;`)();

test("강한 AI는 합법 행동을 반환한다", () => {
  const state = initialState({ seed: 42 });
  const action = chooseStrong(publicState(state, "P1"), "P1");
  assert.ok(legalActions(state).some((legal) => legal.id === action.id));
});

test("강한 AI는 서로 다른 코스와 양 진영에서 V5를 이긴다", () => {
  for (const seed of [42, 20260824]) {
    for (const strongSide of ["P1", "P2"]) {
      const v5Side = strongSide === "P1" ? "P2" : "P1";
      let state = initialState({ seed });
      while (!outcome(state)) {
        state = applyActions(state, {
          [strongSide]: chooseStrong(publicState(state, strongSide), strongSide),
          [v5Side]: chooseBuiltIn(state, "v5", v5Side).action,
        });
      }
      assert.equal(state.winner, strongSide);
    }
  }
});
