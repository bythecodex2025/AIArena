import {
  PATRONS,
  SUITS,
  applyAction,
  legalActions,
  otherPlayer,
  outcome,
  scoreBreakdown,
  stateKey,
} from "./engine.js";

const WIN = 1_000_000;
const TIMEOUT = Symbol("timeout");

export const AI_LEVELS = Object.freeze({
  v1: { name: "v1 충동 입찰자", description: "합법 행동 중 하나를 무작위로 선택합니다.", depth: 0 },
  v2: { name: "v2 가치 계산가", description: "유물 가치와 지불액을 한 수 앞에서 비교합니다.", depth: 1 },
  v3: { name: "v3 맞입찰 전략가", description: "상대의 다음 입찰과 패스를 함께 계산합니다.", depth: 2 },
  v4: { name: "v4 컬렉션 큐레이터", description: "4수 알파베타 탐색으로 세트와 다수 경쟁을 읽습니다.", depth: 4 },
  v5: { name: "v5 밤시장 설계자", description: "반복 심화로 자금 소진과 다음 경매까지 계산합니다.", depth: 7, timeMs: 300 },
});

export function chooseAction(state, level = "v3", options = {}) {
  const actions = legalActions(state);
  const started = now();
  if (!actions.length) return result(null, level, 0, 0, 0, started, "none");
  if (level === "v1") {
    const random = options.rng ?? Math.random;
    const action = actions[Math.floor(random() * actions.length)];
    return result(action, level, 1, 0, 0, started, "random");
  }
  if (state.phase === "patron") {
    const preferred = { v2: "curator", v3: "critic", v4: "curator", v5: "broker" }[level] ?? "curator";
    const action = actions.find((item) => item.patronId === preferred) ?? actions[0];
    return result(action, level, actions.length, 1, 0, started, "patron-style");
  }
  if (level === "v2") {
    const player = state.currentPlayer;
    const action = [...actions].sort((left, right) => (
      evaluate(applyAction(state, right), player) - evaluate(applyAction(state, left), player)
      || tacticalScore(state, right, player) - tacticalScore(state, left, player)
      || left.id.localeCompare(right.id)
    ))[0];
    return result(action, level, actions.length, 1, evaluate(applyAction(state, action), player), started, "static-value");
  }
  if (level === "v5") return iterative(state, actions, options, started);

  const depth = AI_LEVELS[level]?.depth ?? 2;
  const context = makeContext(Infinity, level === "v4");
  const found = searchRoot(state, actions, depth, state.currentPlayer, context);
  return result(found.action, level, context.nodes, depth, found.score, started, level === "v4" ? "alpha-beta-table" : "minimax");
}

export function evaluate(state, player) {
  const end = outcome(state);
  if (end) {
    if (!end.winner) return 0;
    return end.winner === player ? WIN - state.ply : -WIN + state.ply;
  }
  const opponent = otherPlayer(player);
  const scores = scoreBreakdown(state);
  let score = (scores[player].total - scores[opponent].total) * 120;
  score += (state.favor[player] - state.favor[opponent]) * 38;
  score += (state.collections[player].length - state.collections[opponent].length) * 24;
  if (state.phase === "auction" && state.currentLot && state.leader) {
    const value = lotUtility(state, state.currentLot, state.leader);
    const swing = value * 65 - state.leaderCost * 38;
    score += state.leader === player ? swing : -swing;
  }
  if (state.phase === "patron") score += patronOutlook(state, player) - patronOutlook(state, opponent);
  return score;
}

function iterative(state, actions, options, started) {
  const deadline = now() + Math.max(40, options.timeMs ?? AI_LEVELS.v5.timeMs);
  const maxDepth = Math.max(2, options.maxDepth ?? AI_LEVELS.v5.depth);
  const context = makeContext(deadline, true);
  let completed = { action: actions[0], score: -Infinity, depth: 1 };
  for (let depth = 2; depth <= maxDepth; depth += 1) {
    try {
      const found = searchRoot(state, actions, depth, state.currentPlayer, context);
      completed = { ...found, depth };
      if (Math.abs(found.score) > WIN - 200) break;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }
  return result(completed.action, "v5", context.nodes, completed.depth, completed.score, started, "iterative-alpha-beta");
}

function searchRoot(state, actions, depth, root, context) {
  checkTime(context);
  let bestAction = actions[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  for (const action of ordered(state, actions, root)) {
    const score = search(applyAction(state, action), depth - 1, alpha, Infinity, root, context);
    if (score > bestScore || (score === bestScore && action.id < bestAction.id)) {
      bestScore = score;
      bestAction = action;
    }
    alpha = Math.max(alpha, bestScore);
  }
  return { action: bestAction, score: bestScore };
}

function search(state, depth, alpha, beta, root, context) {
  checkTime(context);
  context.nodes += 1;
  if (depth <= 0 || outcome(state)) return evaluate(state, root);
  const key = `${stateKey(state)}|${depth}|${root}`;
  if (context.useTable && context.table.has(key)) return context.table.get(key);
  const maximizing = state.currentPlayer === root;
  let best = maximizing ? -Infinity : Infinity;
  let cutoff = false;
  for (const action of ordered(state, legalActions(state), root)) {
    const value = search(applyAction(state, action), depth - 1, alpha, beta, root, context);
    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) {
      cutoff = true;
      break;
    }
  }
  if (context.useTable && !cutoff) context.table.set(key, best);
  return best;
}

function ordered(state, actions, root) {
  return [...actions].sort((left, right) => (
    tacticalScore(state, right, root) - tacticalScore(state, left, root)
    || left.id.localeCompare(right.id)
  ));
}

function tacticalScore(state, action, root) {
  const sign = state.currentPlayer === root ? 1 : -1;
  if (action.type === "patron") {
    return sign * ({ curator: 130, critic: 120, broker: 125 }[action.patronId] ?? 0);
  }
  if (action.type === "pass") {
    if (!state.leader) return sign * -20;
    const leaderValue = lotUtility(state, state.currentLot, state.leader) * 50 - state.leaderCost * 32;
    return sign * (state.leader === state.currentPlayer ? leaderValue : -leaderValue);
  }
  const utility = lotUtility(state, state.currentLot, state.currentPlayer);
  return sign * (utility * 90 - action.payment * 45 - (action.useFavor ? 25 : 0));
}

function lotUtility(state, lot, player) {
  if (!lot) return 0;
  const patron = PATRONS[state.patrons[player]] ?? PATRONS.curator;
  const mine = Object.fromEntries(SUITS.map((suit) => [suit, state.collections[player].filter((item) => item.suit === suit).length]));
  const theirs = Object.fromEntries(SUITS.map((suit) => [suit, state.collections[otherPlayer(player)].filter((item) => item.suit === suit).length]));
  let value = lot.value;
  const beforeSets = Math.min(...SUITS.map((suit) => mine[suit]));
  mine[lot.suit] += 1;
  const afterSets = Math.min(...SUITS.map((suit) => mine[suit]));
  value += (afterSets - beforeSets) * patron.setBonus;
  if (mine[lot.suit] > theirs[lot.suit] && mine[lot.suit] - 1 <= theirs[lot.suit]) value += patron.majorityBonus;
  if (lot.ability === "refund") value += 1.5;
  if (lot.ability === "favor") value += 1.2;
  return value;
}

function patronOutlook(state, player) {
  const id = state.patrons[player];
  if (!id) return 0;
  const patron = PATRONS[id];
  if (id === "curator") return patron.setBonus * 8;
  if (id === "critic") return patron.majorityBonus * 11;
  return Math.floor(state.credits[player] / patron.creditDivisor) * 6;
}

function makeContext(deadline, useTable) {
  return { deadline, useTable, table: new Map(), nodes: 0 };
}

function checkTime(context) {
  if (now() > context.deadline) throw TIMEOUT;
}

function result(action, level, nodes, depth, score, started, source) {
  return {
    action,
    stats: { level, nodes, depth, score, elapsedMs: Math.round((now() - started) * 10) / 10, source },
  };
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}
