import {
  applyMove,
  legalMoves,
  lionCaptureMoves,
  mirrorKey,
  otherPlayer,
  rowCol,
  stateKey,
} from "./engine.js";

const MATE = 1_000_000;
const TIMEOUT = Symbol("search-timeout");
const MATERIAL = Object.freeze({ lion: 0, giraffe: 560, elephant: 520, chick: 170, hen: 330 });
const exactTablebase = new Map();

export const AI_LEVELS = Object.freeze({
  v1: { name: "v1 탐험가", short: "무작위", depth: 0, timeMs: 0, description: "합법 수 중 하나를 무작위로 선택합니다." },
  v2: { name: "v2 사냥꾼", short: "1수 전술", depth: 1, timeMs: 0, description: "라이온 포획, 트라이, 큰 말 잡기를 우선합니다." },
  v3: { name: "v3 수읽기", short: "3수 미니맥스", depth: 3, timeMs: 0, description: "3수 앞을 미니맥스로 읽고 위험한 교환을 피합니다." },
  v4: { name: "v4 전략가", short: "6수 알파베타", depth: 6, timeMs: 0, description: "알파베타 가지치기와 전치표로 6수를 탐색합니다." },
  v5: { name: "v5 심화 탐색", short: "반복 심화 + 전치표", depth: 16, timeMs: 420, description: "제한 시간 동안 반복 심화 탐색을 수행하며 가장 깊게 완료한 결과를 선택합니다." },
});

export function installTablebase(entries) {
  exactTablebase.clear();
  if (!entries) return 0;
  for (const [key, value] of entries instanceof Map ? entries : Object.entries(entries)) {
    exactTablebase.set(key, value);
  }
  return exactTablebase.size;
}

export function tablebaseSize() {
  return exactTablebase.size;
}

export function chooseMove(state, level = "v3", options = {}) {
  const moves = legalMoves(state);
  if (!moves.length) return result(null, { level, nodes: 0, depth: 0, score: 0, elapsedMs: 0 });
  const started = performanceNow();
  let answer;

  switch (level) {
    case "v1": answer = chooseV1(state, moves, options); break;
    case "v2": answer = chooseV2(state, moves); break;
    case "v3": answer = chooseFixed(state, moves, 3, { useTable: false }); break;
    case "v4": answer = chooseFixed(state, moves, 6, { useTable: true }); break;
    case "v5": answer = chooseV5(state, moves, options); break;
    default: throw new Error(`알 수 없는 AI 단계: ${level}`);
  }
  answer.stats.level = level;
  answer.stats.elapsedMs = Math.round((performanceNow() - started) * 10) / 10;
  return answer;
}

function chooseV1(_state, moves, options) {
  const random = options.random ?? Math.random;
  const move = moves[Math.floor(random() * moves.length)];
  return result(move, { nodes: 1, depth: 0, score: 0, source: "random" });
}

function chooseV2(state, moves) {
  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const next = applyMove(state, move, { validate: false });
    const score = next.winner === state.turn
      ? MATE
      : evaluateFor(next, state.turn) + moveOrderScore(state, move);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return result(best, { nodes: moves.length, depth: 1, score: bestScore, source: "heuristic" });
}

function chooseFixed(state, moves, depth, { useTable }) {
  const context = makeContext({ deadline: Infinity, useTable });
  const searched = searchRoot(state, moves, depth, context);
  return result(searched.move, {
    nodes: context.nodes,
    depth,
    score: searched.score,
    tableHits: context.tableHits,
    source: "search",
  });
}

function chooseV5(state, moves, options) {
  const tableMove = chooseFromTablebase(state, moves);
  if (tableMove) {
    return result(tableMove.move, {
      nodes: moves.length,
      depth: tableMove.dtm ?? "∞",
      score: tableMove.score,
      tableHits: 1,
      source: "tablebase",
      exact: true,
    });
  }

  const timeMs = Math.max(20, options.timeMs ?? AI_LEVELS.v5.timeMs);
  const maxDepth = Math.max(2, options.maxDepth ?? AI_LEVELS.v5.depth);
  const context = makeContext({ deadline: performanceNow() + timeMs, useTable: true });
  let completed = { move: moves[0], score: -Infinity, depth: 0 };

  for (let depth = 2; depth <= maxDepth; depth += 1) {
    try {
      const searched = searchRoot(state, moves, depth, context);
      completed = { ...searched, depth };
      if (Math.abs(searched.score) >= MATE - 500) break;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }

  return result(completed.move, {
    nodes: context.nodes,
    depth: completed.depth,
    score: completed.score,
    tableHits: context.tableHits,
    source: "iterative-search",
    exact: false,
  });
}

function searchRoot(state, inputMoves, depth, context) {
  const moves = orderMoves(state, inputMoves, context.bestMove.get(mirrorKey(state)));
  let alpha = -Infinity;
  let bestMove = moves[0];
  let bestScore = -Infinity;
  const path = new Set([stateKey(state)]);

  for (const move of moves) {
    checkTime(context);
    const next = applyMove(state, move, { validate: false });
    const nextKey = stateKey(next);
    const score = path.has(nextKey) ? 0 : -negamax(next, depth - 1, -Infinity, -alpha, context, path, 1);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;
  }
  context.bestMove.set(mirrorKey(state), bestMove);
  return { move: bestMove, score: bestScore };
}

function negamax(state, depth, alpha, beta, context, path, ply) {
  context.nodes += 1;
  if ((context.nodes & 255) === 0) checkTime(context);

  const terminal = terminalScore(state, ply);
  if (terminal !== null) return terminal;

  const canonical = mirrorKey(state);
  if (context.useTable) {
    const exact = exactTablebase.get(canonical);
    if (exact) {
      context.tableHits += 1;
      return tablebaseScore(exact, ply);
    }
  }
  if (depth <= 0) return evaluateFor(state, state.turn);

  const cached = context.transposition.get(canonical);
  const originalAlpha = alpha;
  if (cached && cached.depth >= depth) {
    context.tableHits += 1;
    if (cached.flag === "exact") return cached.score;
    if (cached.flag === "lower") alpha = Math.max(alpha, cached.score);
    if (cached.flag === "upper") beta = Math.min(beta, cached.score);
    if (alpha >= beta) return cached.score;
  }

  const available = legalMoves(state);
  if (!available.length) return -MATE + ply;
  const moves = orderMoves(state, available, cached?.move ?? context.bestMove.get(canonical));
  let best = -Infinity;
  let bestMove = moves[0];

  path.add(stateKey(state));
  for (const move of moves) {
    const next = applyMove(state, move, { validate: false });
    const key = stateKey(next);
    const score = path.has(key) ? 0 : -negamax(next, depth - 1, -beta, -alpha, context, path, ply + 1);
    if (score > best) {
      best = score;
      bestMove = move;
    }
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }
  path.delete(stateKey(state));

  const flag = best <= originalAlpha ? "upper" : best >= beta ? "lower" : "exact";
  context.transposition.set(canonical, { depth, score: best, flag, move: bestMove });
  context.bestMove.set(canonical, bestMove);
  return best;
}

function chooseFromTablebase(state, moves) {
  const current = exactTablebase.get(mirrorKey(state));
  if (!current) return null;
  let best = null;
  for (const move of moves) {
    const next = applyMove(state, move, { validate: false });
    const child = exactTablebase.get(mirrorKey(next));
    if (!child) continue;
    const score = -tablebaseScore(child, 1);
    const candidate = { move, score, dtm: child.dtm == null ? null : child.dtm + 1 };
    if (!best || candidate.score > best.score
      || (candidate.score === best.score && tieBreakDtm(candidate, best, score))) best = candidate;
  }
  return best;
}

function tieBreakDtm(candidate, best, score) {
  if (candidate.dtm == null || best.dtm == null) return false;
  return score > 0 ? candidate.dtm < best.dtm : candidate.dtm > best.dtm;
}

function terminalScore(state, ply) {
  if (!state.winner) return null;
  if (state.winner === "DRAW") return 0;
  return state.winner === state.turn ? MATE - ply : -MATE + ply;
}

function tablebaseScore(entry, ply) {
  const outcome = typeof entry === "number" ? entry : entry.outcome;
  const dtm = typeof entry === "number" ? 0 : (entry.dtm ?? 0);
  if (outcome === 0) return 0;
  return outcome > 0 ? MATE - dtm - ply : -MATE + dtm + ply;
}

function evaluateFor(state, player) {
  if (state.winner) {
    if (state.winner === "DRAW") return 0;
    return state.winner === player ? MATE : -MATE;
  }
  const opponent = otherPlayer(player);
  let score = 0;
  for (let index = 0; index < 12; index += 1) {
    const item = state.board[index];
    if (!item) continue;
    const sign = item.owner === player ? 1 : -1;
    const [row, column] = rowCol(index);
    score += sign * MATERIAL[item.type];
    if (item.type === "lion") {
      const progress = item.owner === "P1" ? 3 - row : row;
      score += sign * progress * 26;
      if (column === 1) score += sign * 9;
    } else if (item.type === "chick" || item.type === "hen") {
      const progress = item.owner === "P1" ? 3 - row : row;
      score += sign * progress * 18;
    } else if (column === 1) {
      score += sign * 12;
    }
  }
  for (const type of ["chick", "elephant", "giraffe"]) {
    score += state.hands[player][type] * MATERIAL[type] * 1.08;
    score -= state.hands[opponent][type] * MATERIAL[type] * 1.08;
  }
  if (state.pendingTry === player) score += 8_000;
  if (state.pendingTry === opponent) score -= 8_000;
  return score;
}

function moveOrderScore(state, move) {
  let score = 0;
  if (move.type === "move") {
    const moving = state.board[move.from];
    const captured = state.board[move.to];
    if (captured) score += captured.type === "lion" ? MATE : MATERIAL[captured.type] * 12 - MATERIAL[moving.type];
    const [row] = rowCol(move.to);
    if (moving.type === "chick" && ((moving.owner === "P1" && row === 0) || (moving.owner === "P2" && row === 3))) score += 2_000;
    if (moving.type === "lion" && ((moving.owner === "P1" && row === 0) || (moving.owner === "P2" && row === 3))) score += 5_000;
  } else {
    score += move.piece === "chick" ? 35 : 20;
  }
  return score;
}

function orderMoves(state, moves, preferred) {
  return [...moves].sort((left, right) => {
    if (preferred) {
      const leftPreferred = sameShape(left, preferred);
      const rightPreferred = sameShape(right, preferred);
      if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
    }
    return moveOrderScore(state, right) - moveOrderScore(state, left);
  });
}

function sameShape(left, right) {
  return left?.type === right?.type && left?.from === right?.from
    && left?.to === right?.to && left?.piece === right?.piece;
}

function makeContext({ deadline, useTable }) {
  return {
    deadline,
    useTable,
    nodes: 0,
    tableHits: 0,
    transposition: new Map(),
    bestMove: new Map(),
  };
}

function checkTime(context) {
  if (performanceNow() >= context.deadline) throw TIMEOUT;
}

function performanceNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function result(move, stats) {
  return { move, stats: { tableHits: 0, exact: false, ...stats } };
}

export const __testing = Object.freeze({ evaluateFor, terminalScore, moveOrderScore, MATE });
