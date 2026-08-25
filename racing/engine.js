export const RULES_VERSION = "1.0.0";
export const TICKS_PER_SECOND = 15;
export const FIXED_DT = 1 / TICKS_PER_SECOND;
export const MAX_TICKS = 3_000;
export const LAPS_TO_WIN = 3;
export const TRACK_HALF_WIDTH = 24;
export const LOOKAHEAD_DISTANCES = Object.freeze([0, 6, 12, 20, 30, 45, 65, 90]);

const ACTIONS = Object.freeze(
  [-1, 0, 1].flatMap((throttle) => [-1, -0.5, 0, 0.5, 1].map((steering) => Object.freeze({
    id: `drive:t${throttle}:s${steering}`,
    type: "drive",
    throttle,
    steering,
  }))),
);
const TRACK_CACHE = new Map();

export function initialState({ seed = 20260824, startSides = { P1: -1, P2: 1 } } = {}) {
  const track = trackGeometry(seed);
  return {
    gameId: "vector-racing",
    rulesVersion: RULES_VERSION,
    seed: seed >>> 0,
    tick: 0,
    ticksPerSecond: TICKS_PER_SECOND,
    fixedDt: FIXED_DT,
    maxTicks: MAX_TICKS,
    lapsToWin: LAPS_TO_WIN,
    trackLength: round(track.length, 3),
    cars: {
      P1: newCar("P1", startSides.P1 <= 0 ? -7 : 7),
      P2: newCar("P2", startSides.P2 <= 0 ? -7 : 7),
    },
    winner: null,
    reason: null,
    lastActions: [],
  };
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function legalActions(state) {
  return outcome(state) ? [] : ACTIONS.map((action) => ({ ...action }));
}

export function applyActions(state, requestedByPlayer) {
  if (outcome(state)) throw new Error("이미 종료된 경기입니다.");
  const legal = legalActions(state);
  const selected = {};
  for (const player of ["P1", "P2"]) {
    const id = typeof requestedByPlayer?.[player] === "string" ? requestedByPlayer[player] : requestedByPlayer?.[player]?.id;
    const action = legal.find((item) => item.id === id);
    if (!action) throw new Error(`${player} 불법 행동: ${id ?? "undefined"}`);
    selected[player] = action;
  }

  const next = cloneState(state);
  const track = trackGeometry(next.seed);
  next.tick += 1;
  next.lastActions = [];
  for (const player of ["P1", "P2"]) {
    const action = selected[player];
    next.cars[player] = advanceCar(next.cars[player], action, track);
    next.lastActions.push({ player, actionId: action.id, throttle: action.throttle, steering: action.steering });
  }
  settle(next);
  return next;
}

export function outcome(state) {
  return state.reason ? { winner: state.winner, reason: state.reason } : null;
}

export function publicState(state, viewer) {
  if (viewer !== "P1" && viewer !== "P2") throw new Error("viewer는 P1 또는 P2여야 합니다.");
  const me = state.cars[viewer];
  const track = trackGeometry(state.seed);
  const sample = sampleTrack(track, me.s);
  const leftDistance = TRACK_HALF_WIDTH + me.lateral;
  const rightDistance = TRACK_HALF_WIDTH - me.lateral;
  return {
    gameId: state.gameId,
    rulesVersion: state.rulesVersion,
    seed: state.seed,
    tick: state.tick,
    ticksPerSecond: state.ticksPerSecond,
    fixedDt: state.fixedDt,
    maxTicks: state.maxTicks,
    lapsToWin: state.lapsToWin,
    trackLength: state.trackLength,
    currentPlayer: viewer,
    cars: Object.fromEntries(Object.entries(state.cars).map(([id, car]) => [id, publicCar(car, track)])),
    road: {
      halfWidth: TRACK_HALF_WIDTH,
      surface: Math.abs(me.lateral) <= TRACK_HALF_WIDTH ? "asphalt" : "grass",
      nearest: {
        progress: round(me.s, 3),
        lateralOffset: round(me.lateral, 3),
        headingError: round(me.headingError, 5),
        centerX: round(sample.x, 3),
        centerY: round(sample.y, 3),
      },
      edgeDistance: { left: round(leftDistance, 3), right: round(rightDistance, 3) },
      lookahead: LOOKAHEAD_DISTANCES.map((distance) => {
        const point = sampleTrack(track, me.s + distance);
        return {
          distance,
          centerX: round(point.x, 3),
          centerY: round(point.y, 3),
          heading: round(point.heading, 5),
          curvature: round(point.curvature, 6),
          halfWidth: TRACK_HALF_WIDTH,
          recommendedSpeed: round(recommendedSpeed(point.curvature), 2),
        };
      }),
    },
    lastActions: cloneState(state.lastActions),
    legalActions: legalActions(state),
  };
}

export function actionText(action) {
  const drive = action.throttle > 0 ? "가속" : action.throttle < 0 ? "브레이크" : "유지";
  const steer = action.steering < -0.75 ? "강한 좌회전" : action.steering < 0 ? "좌회전" : action.steering > 0.75 ? "강한 우회전" : action.steering > 0 ? "우회전" : "직진";
  return `${drive} · ${steer}`;
}

export function progressRatio(state, player) {
  return Math.min(1, state.cars[player].totalProgress / (state.trackLength * state.lapsToWin));
}

export function stateKey(state) {
  return JSON.stringify([state.seed, state.tick, state.cars.P1, state.cars.P2]);
}

export function trackGeometry(seed = 20260824) {
  const key = seed >>> 0;
  if (TRACK_CACHE.has(key)) return TRACK_CACHE.get(key);
  const random = mulberry32(key);
  const phase3 = random() * Math.PI * 2;
  const phase5 = random() * Math.PI * 2;
  const phase9 = random() * Math.PI * 2;
  const rx = 250 + random() * 15;
  const ry = 180 + random() * 15;
  const count = 360;
  const raw = Array.from({ length: count }, (_, index) => {
    const t = index / count * Math.PI * 2;
    // 큰 3연속 코너, 5개의 급커브, 짧은 S자 굴곡을 겹쳐
    // 교차 없이 헤어핀과 리듬 구간이 생기는 시드 기반 폐곡선을 만든다.
    const radius = 1
      + 0.16 * Math.sin(3 * t + phase3)
      + 0.08 * Math.sin(5 * t + phase5)
      + 0.035 * Math.sin(9 * t + phase9);
    return {
      x: 400 + rx * radius * Math.cos(t),
      y: 320 + ry * radius * Math.sin(t),
    };
  });
  let length = 0;
  const points = raw.map((point, index) => {
    const previous = raw[(index - 1 + count) % count];
    const next = raw[(index + 1) % count];
    const segmentNext = raw[(index + 1) % count];
    const segmentLength = Math.hypot(segmentNext.x - point.x, segmentNext.y - point.y);
    const heading = Math.atan2(next.y - previous.y, next.x - previous.x);
    const result = { ...point, s: length, segmentLength, heading };
    length += segmentLength;
    return result;
  });
  for (let index = 0; index < points.length; index += 1) {
    const previousHeading = points[(index - 2 + points.length) % points.length].heading;
    const nextHeading = points[(index + 2) % points.length].heading;
    const distance = points[(index - 2 + points.length) % points.length].segmentLength + points[(index - 1 + points.length) % points.length].segmentLength + points[index].segmentLength + points[(index + 1) % points.length].segmentLength;
    points[index].curvature = normalizeAngle(nextHeading - previousHeading) / Math.max(1, distance);
  }
  const track = Object.freeze({ seed: key, length, points: Object.freeze(points.map(Object.freeze)) });
  TRACK_CACHE.set(key, track);
  return track;
}

export function sampleTrack(trackOrSeed, requestedS) {
  const track = typeof trackOrSeed === "number" ? trackGeometry(trackOrSeed) : trackOrSeed;
  const s = modulo(requestedS, track.length);
  let low = 0;
  let high = track.points.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (track.points[middle].s <= s) low = middle + 1;
    else high = middle - 1;
  }
  const point = track.points[Math.max(0, high)];
  const next = track.points[(Math.max(0, high) + 1) % track.points.length];
  const ratio = Math.min(1, (s - point.s) / Math.max(0.0001, point.segmentLength));
  return {
    x: point.x + (next.x - point.x) * ratio,
    y: point.y + (next.y - point.y) * ratio,
    heading: lerpAngle(point.heading, next.heading, ratio),
    curvature: point.curvature + (next.curvature - point.curvature) * ratio,
    s,
  };
}

function advanceCar(car, action, track) {
  const next = { ...car };
  const onRoad = Math.abs(next.lateral) <= TRACK_HALF_WIDTH;
  const acceleration = action.throttle > 0 ? 17 : action.throttle < 0 ? -30 : -2.2;
  const drag = onRoad ? 0.006 * next.speed * next.speed : 13 + 0.012 * next.speed * next.speed;
  next.speed = clamp(next.speed + (acceleration - drag) * FIXED_DT, 0, 52);
  const grip = onRoad ? 1 : 0.48;
  const yawRate = action.steering * (0.52 + next.speed * 0.021) * grip;
  const center = sampleTrack(track, next.s);
  next.headingError = normalizeAngle(next.headingError + (yawRate - center.curvature * next.speed) * FIXED_DT);
  const forward = Math.max(0, next.speed * Math.cos(next.headingError) * FIXED_DT);
  next.totalProgress += forward;
  next.s = modulo(next.s + forward, track.length);
  next.lateral += next.speed * Math.sin(next.headingError) * FIXED_DT;
  if (Math.abs(next.lateral) > TRACK_HALF_WIDTH + 25) {
    next.lateral = Math.sign(next.lateral) * (TRACK_HALF_WIDTH + 25);
    next.headingError *= -0.25;
    next.speed *= 0.35;
    next.incidents += 1;
  }
  next.lap = Math.min(LAPS_TO_WIN, Math.floor(next.totalProgress / track.length));
  next.lastActionId = action.id;
  return next;
}

function settle(state) {
  const finishDistance = state.trackLength * state.lapsToWin;
  const finishers = ["P1", "P2"].filter((player) => state.cars[player].totalProgress >= finishDistance);
  if (finishers.length) {
    finishers.sort((a, b) => state.cars[b].totalProgress - state.cars[a].totalProgress || state.cars[b].speed - state.cars[a].speed || a.localeCompare(b));
    state.winner = finishers[0];
    state.reason = `${state.winner}이 ${formatTime(state.tick)}에 ${LAPS_TO_WIN}랩을 먼저 완주했습니다.`;
    return;
  }
  if (state.tick < state.maxTicks) return;
  const difference = state.cars.P1.totalProgress - state.cars.P2.totalProgress;
  if (Math.abs(difference) > 0.01) state.winner = difference > 0 ? "P1" : "P2";
  else if (state.cars.P1.incidents !== state.cars.P2.incidents) state.winner = state.cars.P1.incidents < state.cars.P2.incidents ? "P1" : "P2";
  state.reason = state.winner
    ? `제한 시간 종료 · ${state.winner}이 더 먼 거리까지 주행했습니다.`
    : "제한 시간 종료 · 거리와 코스 이탈 횟수가 같아 무승부입니다.";
}

function publicCar(car, track) {
  const center = sampleTrack(track, car.s);
  const normalX = -Math.sin(center.heading);
  const normalY = Math.cos(center.heading);
  return {
    id: car.id,
    x: round(center.x + normalX * car.lateral, 3),
    y: round(center.y + normalY * car.lateral, 3),
    heading: round(center.heading + car.headingError, 5),
    speed: round(car.speed, 3),
    speedKph: round(car.speed * 3.6, 1),
    progress: round(car.s, 3),
    totalProgress: round(car.totalProgress, 3),
    lateralOffset: round(car.lateral, 3),
    headingError: round(car.headingError, 5),
    lap: car.lap,
    incidents: car.incidents,
    lastActionId: car.lastActionId,
  };
}

function newCar(id, lateral) {
  return { id, s: 0, totalProgress: 0, lateral, speed: 0, headingError: 0, lap: 0, incidents: 0, lastActionId: "drive:t0:s0" };
}

function recommendedSpeed(curvature) {
  return clamp(5.2 / Math.sqrt(Math.max(0.0001, Math.abs(curvature))), 15, 52);
}

export function formatTime(tick) {
  const seconds = tick / TICKS_PER_SECOND;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, digits) { const scale = 10 ** digits; return Math.round(value * scale) / scale; }
function modulo(value, divisor) { return ((value % divisor) + divisor) % divisor; }
function normalizeAngle(value) { return Math.atan2(Math.sin(value), Math.cos(value)); }
function lerpAngle(from, to, amount) { return from + normalizeAngle(to - from) * amount; }
function mulberry32(seed) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let value = Math.imul(seed ^ seed >>> 15, 1 | seed); value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value; return ((value ^ value >>> 14) >>> 0) / 4294967296; }; }
