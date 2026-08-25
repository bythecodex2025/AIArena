import test from "node:test";
import assert from "node:assert/strict";
import { chooseAction } from "../ai.js";
import { initialState, node, stateKey } from "../engine.js";

function hackingState() {
  const state = initialState();
  state.energy.P1 = 4;
  state.nodes = [
    node("P1-a", "P1", 21), node("P1-b", "P1", 16), node("P1-c", "P1", 11),
    node("P1-d", "P1", 6), node("P1-e", "P1", 1),
  ];
  state.nextNodeIds = { P1: 20, P2: 20 };
  state.repetitions = { [stateKey(state)]: 1 };
  return state;
}

test("v1은 주입한 난수로 재현 가능한 행동을 고른다", () => {
  const state = initialState();
  assert.equal(chooseAction(state, "v1", { rng: () => 0 }).action.id, chooseAction(state, "v1", { rng: () => 0 }).action.id);
});

for (const level of ["v2", "v3", "v4", "v5"]) {
  test(`${level}는 즉시 가능한 코어 해킹을 선택한다`, () => {
    const result = chooseAction(hackingState(), level, { timeMs: 80, maxDepth: 4 });
    assert.equal(result.action.type, "hack");
    assert.ok(result.stats.nodes >= 1);
  });
}
