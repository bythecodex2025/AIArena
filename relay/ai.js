import {
  applyAction,
  legalActions,
  otherPlayer,
  outcome,
  poweredNodeIds,
  relayControl,
  stateKey,
  CORE_POSITIONS,
  RELAY_POSITIONS,
} from "./engine.js";

const MATE = 1_000_000;
const TIMEOUT = Symbol("timeout");

export const AI_LEVELS = Object.freeze({
  v1: { name: "v1 무작위 설치", description: "가능한 행동 중 하나를 무작위로 고릅니다.", depth: 0 },
  v2: { name: "v2 중계기 공략", description: "기지 해킹·적 노드 제거·중계기 점령을 우선합니다.", depth: 1 },
  v3: { name: "v3 맞대응 탐색", description: "상대의 다음 행동까지 읽습니다.", depth: 2 },
  v4: { name: "v4 통신망 설계자", description: "4반수 알파베타 탐색으로 연결과 방어를 계산합니다.", depth: 4 },
  v5: { name: "v5 전술 사령관", description: "반복 심화 탐색으로 우회 연결과 절단 위험을 평가합니다.", depth: 7, timeMs: 350 },
});

export function chooseAction(state, level = "v3", options = {}) {
  const actions = legalActions(state);
  const started = now();
  if (!actions.length) return makeResult(null, level, 0, 0, 0, started, "none");

  if (level === "v1") {
    const rng = options.rng ?? Math.random;
    const action = actions[Math.floor(rng() * actions.length)];
    return makeResult(action, level, 1, 0, 0, started, "random");
  }
  if (level === "v2") {
    const action = [...actions].sort((left, right) => (
      tacticalActionScore(state, right, state.currentPlayer) - tacticalActionScore(state, left, state.currentPlayer)
      || left.id.localeCompare(right.id)
    ))[0];
    return makeResult(action, level, actions.length, 1, evaluate(applyAction(state, action), state.currentPlayer), started, "heuristic");
  }

  if (level === "v5") return chooseIterative(state, actions, options, started);
  const depth = AI_LEVELS[level]?.depth ?? AI_LEVELS.v3.depth;
  const context = makeContext(Infinity, level === "v4");
  const searched = searchRoot(state, actions, depth, state.currentPlayer, context);
  return makeResult(searched.action, level, context.nodes, depth, searched.score, started, level === "v4" ? "alpha-beta-table" : "minimax");
}

export function evaluate(state, player) {
  const end = outcome(state);
  if (end) {
    if (!end.winner) return 0;
    return end.winner === player ? MATE - state.ply : -MATE + state.ply;
  }

  const opponent = otherPlayer(player);
  const controls = relayControl(state);
  const controlled = (side) => controls.filter((relay) => relay.owner === side).length;
  const powered = (side) => poweredNodeIds(state, side);
  const mine = powered(player);
  const theirs = powered(opponent);
  let score = 0;
  score += (state.signalScores[player] - state.signalScores[opponent]) * 2_600;
  score += (controlled(player) - controlled(opponent)) * 1_000;
  score += controls.reduce((total, relay) => (
    total + (relay.influence[player] - relay.influence[opponent]) * 260
  ), 0);
  score += (mine.size - theirs.size) * 130;
  score += (state.nodes.filter((item) => item.owner === player).length - state.nodes.filter((item) => item.owner === opponent).length) * 45;
  score += (state.nodes.filter((item) => item.owner === player && item.fortified).length - state.nodes.filter((item) => item.owner === opponent && item.fortified).length) * 85;
  score += (state.energy[player] - state.energy[opponent]) * 30;
  score += corePressure(state, player, mine) - corePressure(state, opponent, theirs);
  score += redundancyScore(state, player, mine) - redundancyScore(state, opponent, theirs);
  return score;
}

function chooseIterative(state, actions, options, started) {
  const timeMs = Math.max(30, options.timeMs ?? AI_LEVELS.v5.timeMs);
  const maxDepth = Math.max(2, options.maxDepth ?? AI_LEVELS.v5.depth);
  const context = makeContext(now() + timeMs, true);
  let completed = {
    action: [...actions].sort((a, b) => tacticalActionScore(state, b, state.currentPlayer) - tacticalActionScore(state, a, state.currentPlayer))[0],
    score: -Infinity,
    depth: 1,
  };
  for (let depth = 2; depth <= maxDepth; depth += 1) {
    try {
      const result = searchRoot(state, actions, depth, state.currentPlayer, context);
      completed = { ...result, depth };
      if (Math.abs(result.score) > MATE - 100) break;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }
  return makeResult(completed.action, "v5", context.nodes, completed.depth, completed.score, started, "iterative-alpha-beta");
}

function searchRoot(state, actions, depth, root, context) {
  checkDeadline(context);
  let bestAction = actions[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const ordered = orderedActions(state, actions, root, depth);
  for (const action of ordered) {
    const next = applyAction(state, action);
    const score = search(next, depth - 1, alpha, Infinity, root, context);
    if (score > bestScore || (score === bestScore && action.id < bestAction.id)) {
      bestScore = score;
      bestAction = action;
    }
    alpha = Math.max(alpha, bestScore);
  }
  return { action: bestAction, score: bestScore };
}

function search(state, depth, alpha, beta, root, context) {
  checkDeadline(context);
  context.nodes += 1;
  if (depth <= 0 || outcome(state)) return evaluate(state, root);

  // 초패 규칙에서는 같은 현재 상태라도 과거 방문 이력에 따라 합법 행동이 달라진다.
  const history = Object.keys(state.repetitions ?? {}).sort().join(";");
  const cacheKey = `${stateKey(state)}|ply${state.ply}|${depth}|${root}|${history}`;
  if (context.useTable && context.table.has(cacheKey)) {
    context.tableHits += 1;
    return context.table.get(cacheKey);
  }

  const maximizing = state.currentPlayer === root;
  let best = maximizing ? -Infinity : Infinity;
  let cutoff = false;
  const actions = orderedActions(state, legalActions(state), root, depth);
  for (const action of actions) {
    const score = search(applyAction(state, action), depth - 1, alpha, beta, root, context);
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) {
      cutoff = true;
      break;
    }
  }
  if (context.useTable && !cutoff) context.table.set(cacheKey, best);
  return best;
}

function orderedActions(state, actions, root, depth) {
  const sorted = [...actions].sort((left, right) => {
    const delta = tacticalActionScore(state, right, root) - tacticalActionScore(state, left, root);
    return delta || left.id.localeCompare(right.id);
  });
  const limit = depth >= 5 ? 14 : depth >= 3 ? 16 : 22;
  return sorted.slice(0, limit);
}

function tacticalActionScore(state, action, player) {
  const actor = state.currentPlayer;
  const sign = actor === player ? 1 : -1;
  if (action.type === "hack") return sign * 900_000;
  let score = 0;
  if (action.type === "swap") {
    score = 1_500;
  } else if (action.type === "overload") {
    const target = state.nodes.find((item) => item.id === action.targetId);
    score = 1_800 + (target?.fortified ? 500 : 0);
  } else if (action.type === "extend") {
    if (RELAY_POSITIONS.some((position) => manhattan(action.to, position) === 1)) score += 900;
    const enemyCore = CORE_POSITIONS[otherPlayer(actor)];
    const [row, column] = [Math.floor(action.to / 5), action.to % 5];
    const [coreRow, coreColumn] = [Math.floor(enemyCore / 5), enemyCore % 5];
    score += 350 - (Math.abs(row - coreRow) + Math.abs(column - coreColumn)) * 35;
  } else if (action.type === "fortify") score = 500;
  else score = state.energy[actor] >= 4 ? -250 : 40;
  return sign * score;
}

function corePressure(state, player, poweredIds) {
  const enemyCore = CORE_POSITIONS[otherPlayer(player)];
  let closest = 8;
  for (const item of state.nodes) {
    if (item.owner !== player || !poweredIds.has(item.id)) continue;
    const distance = manhattan(item.position, enemyCore);
    closest = Math.min(closest, distance);
  }
  return (8 - closest) * 105;
}

function redundancyScore(state, player, poweredIds) {
  let score = 0;
  const ownPositions = new Set([
    CORE_POSITIONS[player],
    ...state.nodes.filter((item) => item.owner === player && poweredIds.has(item.id)).map((item) => item.position),
  ]);
  for (const item of state.nodes) {
    if (item.owner !== player || !poweredIds.has(item.id)) continue;
    const links = neighborsLocal(item.position).filter((position) => ownPositions.has(position)).length;
    if (links >= 2) score += 35 * (links - 1);
  }
  return score;
}

function neighborsLocal(position) {
  const row = Math.floor(position / 5);
  const column = position % 5;
  return [[-1, 0], [1, 0], [0, -1], [0, 1]]
    .map(([dr, dc]) => [row + dr, column + dc])
    .filter(([r, c]) => r >= 0 && r < 5 && c >= 0 && c < 5)
    .map(([r, c]) => r * 5 + c);
}

function manhattan(left, right) {
  return Math.abs(Math.floor(left / 5) - Math.floor(right / 5)) + Math.abs(left % 5 - right % 5);
}

function makeContext(deadline, useTable) {
  return { deadline, useTable, nodes: 0, tableHits: 0, table: new Map() };
}

function checkDeadline(context) {
  if (now() >= context.deadline) throw TIMEOUT;
}

function makeResult(action, level, nodes, depth, score, started, source) {
  return {
    action,
    stats: {
      level,
      nodes,
      depth,
      score,
      source,
      elapsedMs: Math.round((now() - started) * 10) / 10,
    },
  };
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}
