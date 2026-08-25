import test from "node:test";
import assert from "node:assert/strict";
import { initialState, legalActions } from "../engine.js";
import { AI_LEVELS, chooseAction } from "../ai.js";

for (const level of Object.keys(AI_LEVELS)) {
  test(`${level}은 양쪽 차량에 대해 합법 행동을 고른다`, () => {
    const state = initialState({ seed: 9 });
    for (const player of ["P1", "P2"]) {
      const choice = chooseAction(state, level, player);
      assert.ok(legalActions(state).some((action) => action.id === choice.action.id));
    }
  });
}
