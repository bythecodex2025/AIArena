import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAction,
  assertValidState,
  initialState,
  legalActions,
  node,
  poweredNodeIds,
  publicState,
  relayControl,
  stateKey,
} from "../engine.js";

function customState({ currentPlayer = "P1", energy = { P1: 4, P2: 4 }, nodes = [], ply = 0 } = {}) {
  const state = initialState();
  state.currentPlayer = currentPlayer;
  state.energy = { ...energy };
  state.nodes = nodes.map((item) => ({ ...item }));
  state.nextNodeIds = { P1: 20, P2: 20 };
  state.ply = ply;
  state.signalScores = { P1: 0, P2: 0 };
  state.winner = null;
  state.reason = null;
  state.repetitions = {};
  state.repetitions[stateKey(state)] = 1;
  return state;
}

test("초기 상태는 유효하고 P1이 충전된 상태로 시작한다", () => {
  const state = initialState();
  assert.equal(assertValidState(state), true);
  assert.deepEqual(state.energy, { P1: 3, P2: 2 });
  assert.deepEqual([...poweredNodeIds(state, "P1")].sort(), ["P1-n1", "P1-n2"]);
  assert.equal(legalActions(state).filter((action) => action.type === "extend").length, 5);
  assert.ok(legalActions(state).some((action) => action.type === "fortify"));
  assert.equal(legalActions(state).at(-1).id, "wait");
});

test("연결은 전력망에 인접한 빈칸에만 생성된다", () => {
  const state = initialState();
  const before = JSON.stringify(state);
  assert.ok(legalActions(state).some((action) => action.id === "extend:16"));
  assert.ok(!legalActions(state).some((action) => action.id === "extend:0"));
  const next = applyAction(state, "extend:16");
  assert.equal(JSON.stringify(state), before);
  assert.ok(next.nodes.some((item) => item.owner === "P1" && item.position === 16));
  assert.equal(next.energy.P1, 2);
  assert.equal(next.currentPlayer, "P2");
  assert.equal(next.energy.P2, 3);
});

test("후공은 선공의 첫 행동 직후 한 번만 진영을 교환할 수 있다", () => {
  const opened = applyAction(initialState(), "extend:16");
  assert.equal(opened.currentPlayer, "P2");
  assert.ok(legalActions(opened).some((action) => action.id === "swap"));

  const swapped = applyAction(opened, "swap");
  assert.equal(swapped.ply, 2);
  assert.equal(swapped.currentPlayer, "P1");
  assert.deepEqual(swapped.energy, { P1: 3, P2: 2 });
  assert.deepEqual(
    swapped.cores.map(({ id, owner, position }) => ({ id, owner, position })),
    [
      { id: "P1-core", owner: "P1", position: 22 },
      { id: "P2-core", owner: "P2", position: 2 },
    ],
  );
  assert.ok(swapped.nodes.some((item) => item.id === "P2-n3" && item.owner === "P2" && item.position === 8));
  assert.ok(!legalActions(swapped).some((action) => action.id === "swap"));
  assert.equal(assertValidState(swapped), true);
});

test("첫 행동을 넘겨받지 않으면 이후에는 진영 교환이 다시 나오지 않는다", () => {
  let state = applyAction(initialState(), "extend:16");
  state = applyAction(state, "extend:8");
  assert.equal(state.currentPlayer, "P1");
  assert.ok(!legalActions(state).some((action) => action.id === "swap"));
});

test("과거의 전체 상태를 다시 만드는 행동은 합법 행동에서 제외된다", () => {
  const state = initialState();
  const candidate = legalActions(state).find((action) => action.id === "extend:16");
  const repeated = applyAction(state, candidate, { validate: false, trackRepetition: false });
  state.repetitions[stateKey(repeated)] = 1;
  assert.ok(!legalActions(state).some((action) => action.id === "extend:16"));
  assert.ok(legalActions(state).some((action) => action.id !== "extend:16"));
});

test("새 상태를 만들 수 없으면 교착 정산으로 즉시 종료한다", () => {
  const state = initialState();
  const candidates = legalActions(state);
  for (const action of candidates) {
    const preview = applyAction(state, action, { validate: false, trackRepetition: false });
    state.repetitions[stateKey(preview)] = 1;
  }
  assert.deepEqual(legalActions(state), [{ id: "settle", type: "settle", cost: 0 }]);
  const settled = applyAction(state, "settle");
  assert.equal(settled.winner, "P1");
  assert.match(settled.reason, /교착 정산/);
});

test("중간 노드가 제거되면 뒤쪽 연결망은 비활성화된다", () => {
  const state = customState({ currentPlayer: "P2", nodes: [
    node("P1-a", "P1", 21), node("P1-cut", "P1", 16), node("P1-b", "P1", 11), node("P1-c", "P1", 6),
  ] });
  assert.equal(poweredNodeIds(state, "P1").size, 4);
  const next = applyAction(state, { id: "overload:P1-cut", type: "overload", targetId: "P1-cut", cost: 2 }, { validate: false });
  assert.deepEqual([...poweredNodeIds(next, "P1")], ["P1-a"]);
  assert.ok(next.nodes.some((item) => item.id === "P1-c"));
});

test("우회 경로가 있으면 중간 노드 하나를 잃어도 전력이 유지된다", () => {
  const state = customState({ currentPlayer: "P2", nodes: [
    node("P1-a", "P1", 21), node("P1-b", "P1", 16), node("P1-c", "P1", 15), node("P1-d", "P1", 20),
  ] });
  const next = applyAction(state, { id: "overload:P1-b", type: "overload", targetId: "P1-b", cost: 2 }, { validate: false });
  assert.ok(poweredNodeIds(next, "P1").has("P1-c"));
  assert.ok(poweredNodeIds(next, "P1").has("P1-d"));
});

test("일반 노드는 두 방향, 강화 노드는 세 방향에서만 과부하할 수 있다", () => {
  const baseNodes = [
    node("P1-a", "P1", 21), node("P1-b", "P1", 16),
    node("P2-target", "P2", 17),
  ];
  const normal = customState({ nodes: baseNodes });
  assert.ok(legalActions(normal).some((action) => action.id === "overload:P2-target"));
  const fortified = customState({ nodes: baseNodes.map((item) => item.id === "P2-target" ? { ...item, fortified: true } : item) });
  assert.ok(!legalActions(fortified).some((action) => action.id === "overload:P2-target"));
  fortified.nodes.push(node("P1-c", "P1", 23), node("P1-d", "P1", 18));
  assert.ok(legalActions(fortified).some((action) => action.id === "overload:P2-target"));
});

test("중앙으로 먼저 진출해도 상대가 맞은편에 놓으면 중계기는 즉시 경합 상태가 된다", () => {
  let state = initialState();
  state = applyAction(state, "extend:17");
  state = applyAction(state, "extend:7");
  const center = relayControl(state).find((relay) => relay.position === 12);
  assert.equal(center.owner, null);
  assert.deepEqual(center.influence, { P1: 1, P2: 1 });
});

test("중앙 중계기는 중립 시설이라 노드를 직접 놓을 수 없다", () => {
  const state = initialState();
  for (const position of [5, 12, 19]) {
    assert.ok(!legalActions(state).some((action) => action.type === "extend" && action.to === position));
  }
  const invalid = customState({ nodes: [node("P1-invalid", "P1", 12)] });
  assert.throws(() => assertValidState(invalid), /중계기/);
});

test("중계기 주변 활성 노드가 더 많은 쪽이 점령한다", () => {
  const state = customState({ nodes: [
    node("P1-a", "P1", 21), node("P1-b", "P1", 16), node("P1-c", "P1", 17), node("P1-d", "P1", 11),
    node("P2-a", "P2", 1), node("P2-b", "P2", 6), node("P2-c", "P2", 7),
  ] });
  const center = relayControl(state).find((relay) => relay.position === 12);
  assert.equal(center.owner, "P1");
  assert.deepEqual(center.influence, { P1: 2, P2: 1 });
});

test("비활성 노드는 과부하 포위와 강화에 사용할 수 없다", () => {
  const state = customState({ nodes: [
    node("P1-island", "P1", 16), node("P1-island2", "P1", 18),
    node("P2-target", "P2", 17),
  ] });
  assert.ok(!legalActions(state).some((action) => action.id === "overload:P2-target"));
  assert.ok(!legalActions(state).some((action) => action.id === "fortify:P1-island"));
});

test("인접한 전력 노드와 에너지 3이 있으면 코어 해킹으로 즉시 승리한다", () => {
  const state = customState({ nodes: [
    node("P1-a", "P1", 21), node("P1-b", "P1", 16), node("P1-c", "P1", 11),
    node("P1-d", "P1", 6), node("P1-e", "P1", 1),
  ] });
  assert.ok(legalActions(state).some((action) => action.id === "hack:P2-core"));
  const next = applyAction(state, "hack:P2-core");
  assert.equal(next.winner, "P1");
  assert.match(next.reason, /해킹/);
});

test("양측은 자기 행동 뒤 득점하고 승부는 P2 응답 뒤 판정한다", () => {
  let state = customState({ nodes: [
    node("P1-a", "P1", 21), node("P1-b", "P1", 16), node("P1-c", "P1", 17),
    node("P1-d", "P1", 11), node("P1-e", "P1", 18), node("P1-f", "P1", 23), node("P1-g", "P1", 24),
    node("P2-a", "P2", 3),
  ] });
  state.signalScores.P1 = 3;
  const pending = applyAction(state, "wait");
  assert.equal(pending.winner, null);
  assert.equal(pending.signalScores.P1, 5);
  const next = applyAction(pending, "wait");
  assert.equal(next.winner, "P1");
});

test("양측이 같은 라운드에 5점 동점이면 즉시 무승부로 끝난다", () => {
  const state = customState({ nodes: [
    node("P1-a", "P1", 21), node("P1-b", "P1", 16), node("P1-c", "P1", 17), node("P1-d", "P1", 18), node("P1-e", "P1", 23), node("P1-f", "P1", 24),
    node("P2-a", "P2", 1), node("P2-b", "P2", 6), node("P2-c", "P2", 7), node("P2-d", "P2", 3), node("P2-e", "P2", 0), node("P2-f", "P2", 4),
  ] });
  state.signalScores = { P1: 4, P2: 4 };
  const pending = applyAction(state, "wait");
  const next = applyAction(pending, "wait");
  assert.deepEqual(next.signalScores, { P1: 5, P2: 5 });
  assert.equal(next.winner, "DRAW");
  assert.match(next.reason, /함께 달성/);
});

test("중계기 제어를 잃어도 이미 획득한 신호 점수는 유지된다", () => {
  const state = customState({ nodes: [
    node("P1-a", "P1", 21), node("P1-cut", "P1", 17), node("P1-link", "P1", 16),
    node("P1-center", "P1", 11), node("P1-home1", "P1", 18), node("P1-home2", "P1", 23), node("P1-home3", "P1", 24),
  ] });
  state.currentPlayer = "P2";
  state.signalScores.P1 = 2;
  state.repetitions = { [stateKey(state)]: 1 };
  const next = applyAction(state, { id: "overload:P1-cut", type: "overload", targetId: "P1-cut", cost: 2 }, { validate: false });
  assert.equal(next.signalScores.P1, 2);
  assert.equal(relayControl(next).filter((relay) => relay.owner === "P1").length, 1);
});

test("최대 48반수에는 정의된 우선순위로 승자를 정한다", () => {
  const state = customState({
    ply: 47,
    nodes: [
      node("P1-a", "P1", 21), node("P1-b", "P1", 16), node("P1-c", "P1", 17),
      node("P1-d", "P1", 11), node("P1-e", "P1", 18), node("P1-f", "P1", 23), node("P1-g", "P1", 24),
      node("P2-a", "P2", 3),
    ],
  });
  const next = applyAction(state, "wait");
  assert.equal(next.winner, "P1");
  assert.match(next.reason, /신호 점수 우위/);
});

test("48번째 행동 뒤에는 다음 차례 에너지를 선지급하지 않는다", () => {
  const state = customState({ currentPlayer: "P2", ply: 47, energy: { P1: 2, P2: 2 }, nodes: [] });
  const next = applyAction(state, "wait");
  assert.deepEqual(next.energy, { P1: 2, P2: 2 });
  assert.equal(next.winner, "DRAW");
  assert.match(next.reason, /완전 동률/);
});

test("공개 상태에는 계산된 전력·릴레이·합법 행동이 들어간다", () => {
  const view = publicState(initialState());
  assert.equal(view.gameId, "relay-forge");
  assert.ok(view.nodes.every((item) => typeof item.powered === "boolean"));
  assert.equal(view.relays.length, 3);
  assert.ok(view.legalActions.length > 0);
  assert.equal("repetitions" in view, false);
});
