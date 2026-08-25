import test from "node:test";
import assert from "node:assert/strict";
import {
  ARTIFACTS,
  PATRONS,
  applyAction,
  initialState,
  legalActions,
  outcome,
  publicState,
  scoreBreakdown,
  stateKey,
} from "../engine.js";

function auctionState(seed = 18) {
  let state = initialState({ seed });
  state = applyAction(state, "patron:curator");
  state = applyAction(state, "patron:critic");
  return state;
}

test("같은 시드는 같은 유물 순서를 만든다", () => {
  const left = initialState({ seed: 99 });
  const right = initialState({ seed: 99 });
  assert.deepEqual(left.deck.map((item) => item.id), right.deck.map((item) => item.id));
  assert.notDeepEqual(left.deck.map((item) => item.id), initialState({ seed: 100 }).deck.map((item) => item.id));
});

test("양측이 후원자를 고른 뒤 첫 경매가 열린다", () => {
  let state = initialState({ seed: 20260812 });
  assert.equal(legalActions(state).length, Object.keys(PATRONS).length);
  state = applyAction(state, "patron:broker");
  assert.equal(state.currentPlayer, "P2");
  state = applyAction(state, "patron:critic");
  assert.equal(state.phase, "auction");
  assert.equal(state.currentPlayer, "P1");
  assert.ok(state.currentLot);
  assert.ok(state.nextLot);
});

test("일반 입찰은 가격을 올리고 원본 상태를 바꾸지 않는다", () => {
  const state = auctionState();
  const before = JSON.stringify(state);
  const next = applyAction(state, "bid:2");
  assert.equal(JSON.stringify(state), before);
  assert.equal(next.highBid, 2);
  assert.equal(next.leader, "P1");
  assert.equal(next.leaderCost, 2);
  assert.equal(next.currentPlayer, "P2");
});

test("영향력 입찰은 제시가보다 1 적게 지불하고 토큰을 쓴다", () => {
  const state = auctionState();
  const next = applyAction(state, "favor:4");
  assert.equal(next.highBid, 4);
  assert.equal(next.leaderCost, 3);
  assert.equal(next.favor.P1, 1);
});

test("상대가 패스하면 선두가 유물을 낙찰받고 다음 경매로 넘어간다", () => {
  let state = auctionState(34);
  const lot = state.currentLot;
  state = applyAction(state, "bid:1");
  state = applyAction(state, "pass");
  assert.equal(state.collections.P1[0].id, lot.id);
  const expectedCredits = 21 + (lot.ability === "refund" ? 2 : 0);
  assert.equal(state.credits.P1, expectedCredits);
  assert.equal(state.lotIndex, 1);
  assert.equal(state.openingPlayer, "P2");
});

test("아무도 입찰하지 않고 두 번 패스하면 유물을 유찰한다", () => {
  let state = auctionState();
  const lot = state.currentLot.id;
  state = applyAction(state, "pass");
  assert.equal(state.lotIndex, 0);
  state = applyAction(state, "pass");
  assert.equal(state.discarded[0].id, lot);
  assert.equal(state.lotIndex, 1);
});

test("점수는 기본 가치·세트·분야 다수·잔여 자금을 합산한다", () => {
  const state = initialState();
  state.patrons = { P1: "curator", P2: "broker" };
  state.collections.P1 = [
    ARTIFACTS.find((item) => item.id === "solar-crown"),
    ARTIFACTS.find((item) => item.id === "lunar-clock"),
    ARTIFACTS.find((item) => item.id === "nova-heart"),
  ].map((item) => ({ ...item }));
  const scores = scoreBreakdown(state);
  assert.deepEqual(scores.P1.counts, { SOLAR: 1, LUNAR: 1, NOVA: 1 });
  assert.equal(scores.P1.base, 15);
  assert.equal(scores.P1.setPoints, 7);
  assert.equal(scores.P1.majorityPoints, 9);
  assert.equal(scores.P1.creditPoints, 7);
  assert.equal(scores.P1.total, 38);
});

test("공개 상태는 미래 덱을 숨기고 현재 합법 행동을 제공한다", () => {
  const state = auctionState();
  const view = publicState(state);
  assert.equal(view.gameId, "starlight-auction");
  assert.equal("deck" in view, false);
  assert.ok(view.currentLot);
  assert.ok(view.nextLot);
  assert.ok(view.legalActions.length >= 4);
  assert.doesNotThrow(() => JSON.stringify(view));
});

test("경매는 유한하게 끝나고 종료 점수와 사유를 남긴다", () => {
  let state = auctionState(90210);
  while (!outcome(state)) {
    const actions = legalActions(state);
    const action = state.leader
      ? actions.find((item) => item.type === "pass")
      : actions.find((item) => item.type === "bid" && !item.useFavor) ?? actions.find((item) => item.type === "pass");
    state = applyAction(state, action);
  }
  assert.ok(state.ply <= state.maxPlies);
  assert.match(outcome(state).reason, /경매 종료|최대 행동 수/);
});

test("상태 키는 가격과 컬렉션 변화에 반응한다", () => {
  const state = auctionState();
  const next = applyAction(state, "bid:1");
  assert.notEqual(stateKey(state), stateKey(next));
});
