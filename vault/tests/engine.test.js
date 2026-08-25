import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, candidateCodes, feedback, initialState, legalActions, outcome, publicState } from "../engine.js";

test("같은 시드는 같은 비밀 암호를 만든다", () => { assert.deepEqual(initialState({ seed: 7 }).secrets, initialState({ seed: 7 }).secrets); });
test("피드백은 정확 위치와 다른 위치를 구분한다", () => { assert.deepEqual(feedback(["△","○","□"], ["△","□","◇"]), { exact: 1, near: 1 }); });
test("탐색 후 같은 코드는 합법 행동에서 제거된다", () => { let state = initialState({ seed: 2, forceFirst: "P1" }); const action = legalActions(state)[0]; state = applyAction(state, action); state.currentPlayer = "P1"; assert.equal(legalActions(state).some((item) => item.id === action.id), false); });
test("공개 상태는 상대 비밀 암호를 숨긴다", () => { const state = initialState(); const view = publicState(state, state.currentPlayer); assert.equal("secrets" in view, false); assert.ok(view.ownSecret); });
test("선공이 정답을 맞히면 상대에게 같은 라운드의 마지막 응답을 준다", () => { let state = initialState({ seed: 10, forceFirst: "P1" }); const code = state.secrets.P2; state = applyAction(state, `probe:${code.join("")}`); assert.equal(outcome(state), null); assert.equal(state.pendingWinner, "P1"); assert.equal(state.currentPlayer, "P2"); });
test("피드백은 후보 공간을 줄인다", () => { const before = candidateCodes([]).length; const after = candidateCodes([{ code:["△","○","□"], exact:0, near:2 }]).length; assert.ok(after < before); });
