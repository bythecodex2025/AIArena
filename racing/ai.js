import { legalActions, publicState } from "./engine.js";

export const AI_LEVELS = Object.freeze({
  v1: { name: "V1 풀 스로틀", description: "직선 가속만 하는 입문 AI" },
  v2: { name: "V2 에이펙스 리더", description: "헤딩 오차와 중앙선만 추종" },
  v3: { name: "V3 커브 브레이커", description: "30m 전방 곡률로 감속" },
  v4: { name: "V4 벡터 파일럿", description: "도로 폭과 코너 연속성을 함께 예측" },
  v5: { name: "V5 네온 챔피언", description: "속도·곡률·차량 자세를 통합 제어" },
});

export function chooseAction(state, level = "v3", player = "P1") {
  const started = now();
  const view = publicState(state, player);
  const me = view.cars[player];
  let throttle = 1;
  let steering = 0;
  let nodes = 1;

  if (level === "v1") {
    steering = 0;
  } else {
    const short = view.road.lookahead.find((sample) => sample.distance === 12);
    const medium = view.road.lookahead.find((sample) => sample.distance === (level === "v2" ? 20 : 30));
    const long = view.road.lookahead.find((sample) => sample.distance === (level === "v5" ? 65 : 45));
    const futureTurn = medium.curvature * Math.max(12, me.speed) * 2.2 + long.curvature * Math.max(8, me.speed) * 1.2;
    const centering = -me.lateralOffset * (level === "v2" ? 0.045 : 0.065);
    const headingCorrection = -me.headingError * (level === "v5" ? 1.75 : 1.35);
    const steeringDemand = centering + headingCorrection + futureTurn + short.curvature * 5;
    steering = quantizeSteering(steeringDemand);
    const target = Math.min(...view.road.lookahead.slice(2).map((sample) => sample.recommendedSpeed));
    const margin = level === "v2" ? 14 : level === "v3" ? 8 : level === "v4" ? 5 : 2;
    throttle = me.speed < 5 ? 1 : me.speed > target + margin || Math.abs(me.headingError) > 0.78 ? -1 : me.speed < target - 1 ? 1 : 0;
    if (Math.abs(me.lateralOffset) > 19) {
      throttle = me.speed > 19 ? -1 : 1;
      steering = quantizeSteering(-me.lateralOffset * 0.12 - me.headingError * 1.8);
    }
    nodes = view.road.lookahead.length;
  }

  const action = legalActions(state).find((item) => item.throttle === throttle && item.steering === steering) ?? legalActions(state)[0];
  return { action, stats: { level, nodes, depth: level === "v5" ? 3 : level === "v4" ? 2 : 1, elapsedMs: Math.round((now() - started) * 10) / 10 } };
}

function quantizeSteering(value) {
  if (value <= -0.72) return -1;
  if (value <= -0.18) return -0.5;
  if (value >= 0.72) return 1;
  if (value >= 0.18) return 0.5;
  return 0;
}

function now() { return globalThis.performance?.now?.() ?? Date.now(); }
