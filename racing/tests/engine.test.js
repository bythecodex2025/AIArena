import test from "node:test";
import assert from "node:assert/strict";
import { applyActions, FIXED_DT, initialState, legalActions, LOOKAHEAD_DISTANCES, MAX_TICKS, outcome, publicState, TICKS_PER_SECOND, trackGeometry } from "../engine.js";

const straight = "drive:t1:s0";

test("물리 엔진은 초당 15개의 고정 틱을 사용한다", () => {
  assert.equal(TICKS_PER_SECOND, 15);
  assert.equal(FIXED_DT, 1 / 15);
});

test("같은 시드는 같은 트랙을 만든다", () => {
  assert.deepEqual(trackGeometry(42).points, trackGeometry(42).points);
  assert.notDeepEqual(trackGeometry(42).points[0], trackGeometry(43).points[0]);
});

test("복합 코스에는 급커브와 연속 S자 방향 전환이 있다", () => {
  const points = trackGeometry(42).points;
  const maximumCurvature = Math.max(...points.map((point) => Math.abs(point.curvature)));
  let directionChanges = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (Math.sign(points[index].curvature) !== Math.sign(points[index - 1].curvature)) directionChanges += 1;
  }
  assert.ok(maximumCurvature > 0.03);
  assert.ok(directionChanges >= 10);
});

test("매 틱 15개의 가속·감속·조향 조합을 선택한다", () => {
  const actions = legalActions(initialState());
  assert.equal(actions.length, 15);
  assert.ok(actions.some((action) => action.throttle === -1 && action.steering === 1));
});

test("가속 행동은 속도와 진행 거리를 늘린다", () => {
  const state = initialState();
  const next = applyActions(state, { P1: straight, P2: straight });
  assert.equal(next.tick, 1);
  assert.ok(next.cars.P1.speed > 0);
  assert.ok(next.cars.P1.totalProgress > 0);
  assert.equal(state.tick, 0);
});

test("공개 상태는 충분한 전방 도로 샘플과 경계 거리를 제공한다", () => {
  const view = publicState(initialState(), "P1");
  assert.deepEqual(view.road.lookahead.map((sample) => sample.distance), LOOKAHEAD_DISTANCES);
  assert.ok(view.road.lookahead.every((sample) => Number.isFinite(sample.curvature) && Number.isFinite(sample.recommendedSpeed)));
  assert.ok(Number.isFinite(view.road.edgeDistance.left));
});

test("불법 행동은 거부된다", () => {
  assert.throws(() => applyActions(initialState(), { P1: "warp", P2: straight }), /불법 행동/);
});

test("모든 경기는 최대 틱에서 종료된다", () => {
  const state = initialState();
  state.tick = MAX_TICKS - 1;
  const next = applyActions(state, { P1: straight, P2: straight });
  assert.ok(outcome(next));
});
