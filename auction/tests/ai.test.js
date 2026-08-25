import test from "node:test";
import assert from "node:assert/strict";
import { AI_LEVELS, chooseAction } from "../ai.js";
import { applyAction, initialState, legalActions } from "../engine.js";

function stateForAuction() {
  let state = initialState({ seed: 44 });
  state = applyAction(state, "patron:curator");
  state = applyAction(state, "patron:critic");
  return state;
}

test("v1은 주입한 난수로 재현 가능한 합법 행동을 고른다", () => {
  const state = stateForAuction();
  const first = chooseAction(state, "v1", { rng: () => 0 });
  assert.equal(first.action.id, legalActions(state)[0].id);
});

for (const level of Object.keys(AI_LEVELS).filter((item) => item !== "v1")) {
  test(`${level}는 후원자와 입찰 단계에서 모두 합법 행동을 고른다`, () => {
    const patronState = initialState({ seed: 8 });
    const patronChoice = chooseAction(patronState, level, { timeMs: 80, maxDepth: 4 });
    assert.ok(legalActions(patronState).some((item) => item.id === patronChoice.action.id));
    const state = stateForAuction();
    const choice = chooseAction(state, level, { timeMs: 80, maxDepth: 4 });
    assert.ok(legalActions(state).some((item) => item.id === choice.action.id));
    assert.ok(choice.stats.nodes >= 1);
  });
}
