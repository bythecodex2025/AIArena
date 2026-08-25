import test from "node:test";
import assert from "node:assert/strict";
import { initialState, legalActions } from "../engine.js";
import { chooseAction } from "../ai.js";
for (const level of ["v1","v2","v3","v4","v5"]) test(`${level}은 합법 탐색을 고른다`, () => { const state = initialState({ seed: 22, forceFirst:"P1" }); const choice = chooseAction(state, level); assert.ok(legalActions(state).some((item) => item.id === choice.action.id)); });
