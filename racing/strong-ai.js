/**
 * Vector Racing V5 초과 목표 AI
 * AIArena 편집기에 파일 전체를 그대로 붙여 넣을 수 있습니다.
 */
function chooseAction(state, me) {
  const car = state.cars[me];
  const samples = state.road.lookahead;
  const speed = car.speed;

  // 현재 곡률만 따라가지 않고 속도에 따라 6~20m 앞을 미리 조향한다.
  const k0 = samples[0].curvature;
  const k6 = samples[1].curvature;
  const k12 = samples[2].curvature;
  const k20 = samples[3].curvature;
  const speedMix = Math.min(1, speed / 45);
  const controlCurvature = k0 * (0.42 - speedMix * 0.18)
    + k6 * 0.34
    + k12 * (0.18 + speedMix * 0.12)
    + k20 * (0.06 + speedMix * 0.06);

  // 엔진의 실제 yaw 모델을 역산한 feed-forward 조향에 자세 피드백을 더한다.
  const yawCapacity = 0.52 + speed * 0.021;
  const feedForward = controlCurvature * speed / Math.max(0.52, yawCapacity);
  const poseCorrection = -car.headingError * 1.72 - car.lateralOffset * 0.042;
  let steering = quantize(feedForward + poseCorrection);

  // 각 전방 지점에 도착할 때 필요한 안전 속도와 제동 거리를 직접 비교한다.
  // 커브가 끝나는 구간에서는 권장 속도보다 공격적으로 가속한다.
  let mustBrake = false;
  let nearestHazard = Infinity;
  let lowestTarget = 52;
  for (const sample of samples) {
    if (sample.distance < 6) continue;
    const target = cornerSpeed(Math.abs(sample.curvature));
    const brakingDistance = Math.max(0, (speed * speed - target * target) / 54);
    if (brakingDistance > Math.max(0, sample.distance - 5)) {
      mustBrake = true;
      nearestHazard = Math.min(nearestHazard, sample.distance);
    }
    lowestTarget = Math.min(lowestTarget, target);
  }

  let throttle = mustBrake ? -1 : speed < 51.5 ? 1 : 0;
  if (!mustBrake && speed > lowestTarget + 5) throttle = 0;

  // 자세가 크게 무너지면 정지하지 않고 저속으로 복구한다.
  if (Math.abs(car.lateralOffset) > 20 || Math.abs(car.headingError) > 0.92) {
    steering = quantize(-car.headingError * 2.05 - car.lateralOffset * 0.075);
    throttle = speed > 19 ? -1 : 1;
  } else if (nearestHazard < 18 && speed > lowestTarget + 1) {
    throttle = -1;
  }

  return state.legalActions.find(action =>
    action.throttle === throttle && action.steering === steering
  ) || state.legalActions.find(action => action.throttle === 0 && action.steering === 0);
}

function cornerSpeed(curvature) {
  // 최대 조향 시 yawRate = 0.52 + speed * 0.021 모델의 역함수.
  if (curvature <= 0.0215) return 52;
  return Math.max(18, Math.min(52, 0.49 / (curvature - 0.021)));
}

function quantize(value) {
  if (value <= -0.68) return -1;
  if (value <= -0.17) return -0.5;
  if (value >= 0.68) return 1;
  if (value >= 0.17) return 0.5;
  return 0;
}
