import test from "node:test"; import assert from "node:assert/strict"; import { applyAction, finalScore, initialState, legalActions, outcome, publicState } from "../engine.js";
test("같은 시드는 같은 주문 순서를 만든다",()=>assert.deepEqual(initialState({seed:4}).orders,initialState({seed:4}).orders));
test("재료 준비는 팬트리에 두 개를 더한다",()=>{let s=initialState({seed:2,forceFirst:"P1"});const before=s.chefs.P1.pantry.algae;s=applyAction(s,"gather:algae");assert.equal(s.chefs.P1.pantry.algae,before+2)});
test("조리는 재료를 쓰고 점수를 얻는다",()=>{let s=initialState({seed:2,forceFirst:"P1"});s.chefs.P1.pantry={algae:6,spice:6,crystal:6};const action=legalActions(s).find(a=>a.type==="cook"&&!a.seasoned);s=applyAction(s,action);assert.ok(s.chefs.P1.score>0);assert.equal(s.chefs.P1.dishes.length,1)});
test("공개 상태는 숨은 주문 덱을 노출하지 않는다",()=>{const view=publicState(initialState(),"P1");assert.equal("orderDeck" in view,false);assert.ok(view.nextOrder)});
test("24행동 뒤 점수로 종료한다",()=>{let s=initialState({seed:6});while(!outcome(s))s=applyAction(s,legalActions(s)[0]);assert.equal(s.ply,24);assert.ok(outcome(s).reason)});
test("남은 재료 균형은 보너스 점수다",()=>{const s=initialState();s.chefs.P1.pantry={algae:2,spice:3,crystal:4};assert.equal(finalScore(s,"P1").diversity,4)});
