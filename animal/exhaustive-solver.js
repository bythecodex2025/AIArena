import {
  applyMove,
  legalMoves,
  lionCaptureMoves,
  mirrorKey,
  stateKey,
} from "./engine.js";

/**
 * 도달 가능한 상태 그래프를 열거한 뒤 후퇴 분석으로 승/무/패를 확정한다.
 *
 * 전체 초기 국면은 수억 개의 도달 상태를 만들기 때문에 브라우저용 함수가 아니다.
 * maxStates를 Infinity로 주면 알고리즘상 완전 열거를 수행하지만, 대용량 메모리와
 * 장시간 실행이 필요하다. 작은 퍼즐/부분 국면은 즉시 정확히 풀 수 있다.
 */
export function solveExhaustively(startState, options = {}) {
  const maxStates = options.maxStates ?? 250_000;
  const onProgress = options.onProgress ?? (() => {});
  const normalizeMirror = options.normalizeMirror ?? true;
  const keyOf = normalizeMirror ? mirrorKey : stateKey;

  const states = [];
  const keys = [];
  const indexByKey = new Map();
  const successors = [];
  const predecessors = [];
  const terminal = [];
  let cursor = 0;
  let truncated = false;

  addState(startState);
  while (cursor < states.length) {
    const state = states[cursor];
    const childIndices = [];

    if (state.winner) {
      terminal[cursor] = terminalOutcome(state);
    } else {
      // 완전해석의 표준 상태 공간처럼 라이온을 잡을 수 있으면 그 수로 게임을 끝낸다.
      const captures = lionCaptureMoves(state);
      const moves = captures.length ? captures : legalMoves(state);
      if (!moves.length) terminal[cursor] = -1;

      for (const move of moves) {
        const child = applyMove(state, move, { validate: false });
        const key = keyOf(child);
        let childIndex = indexByKey.get(key);
        if (childIndex === undefined) {
          if (states.length >= maxStates) {
            truncated = true;
            continue;
          }
          childIndex = addState(child, key);
        }
        childIndices.push(childIndex);
        predecessors[childIndex].push(cursor);
      }
    }

    successors[cursor] = childIndices;
    cursor += 1;
    if (cursor % 25_000 === 0) onProgress({ visited: cursor, discovered: states.length });
  }

  if (truncated) {
    return {
      complete: false,
      stateCount: states.length,
      reason: `maxStates(${maxStates.toLocaleString()}) 한도에 도달했습니다. 결과 판정은 저장하지 않았습니다.`,
    };
  }

  const outcome = new Int8Array(states.length); // -1 loss, 0 unresolved/draw, 1 win
  const resolved = new Uint8Array(states.length);
  const remaining = new Uint16Array(states.length);
  const dtm = new Uint16Array(states.length);
  const longestWinningChild = new Uint16Array(states.length);
  const queue = new Uint32Array(states.length);
  let head = 0;
  let tail = 0;

  for (let index = 0; index < states.length; index += 1) {
    remaining[index] = successors[index]?.length ?? 0;
    if (terminal[index] !== undefined) {
      outcome[index] = terminal[index];
      resolved[index] = 1;
      queue[tail++] = index;
    }
  }

  while (head < tail) {
    const childIndex = queue[head++];
    const childOutcome = outcome[childIndex];
    for (const parentIndex of predecessors[childIndex]) {
      if (resolved[parentIndex]) continue;

      if (childOutcome === -1) {
        // 상대가 지는 자식이 하나라도 있으면 현재 수의 승리.
        outcome[parentIndex] = 1;
        dtm[parentIndex] = dtm[childIndex] + 1;
        resolved[parentIndex] = 1;
        queue[tail++] = parentIndex;
      } else if (childOutcome === 1) {
        // 모든 자식이 상대 승리일 때만 현재 수의 패배.
        remaining[parentIndex] -= 1;
        longestWinningChild[parentIndex] = Math.max(longestWinningChild[parentIndex], dtm[childIndex]);
        if (remaining[parentIndex] === 0) {
          outcome[parentIndex] = -1;
          dtm[parentIndex] = longestWinningChild[parentIndex] + 1;
          resolved[parentIndex] = 1;
          queue[tail++] = parentIndex;
        }
      }
    }
  }

  const entries = new Map();
  const counts = { win: 0, draw: 0, loss: 0 };
  for (let index = 0; index < states.length; index += 1) {
    const value = resolved[index] ? outcome[index] : 0;
    entries.set(keys[index], { outcome: value, dtm: resolved[index] ? dtm[index] : null });
    if (value > 0) counts.win += 1;
    else if (value < 0) counts.loss += 1;
    else counts.draw += 1;
  }

  return {
    complete: true,
    stateCount: states.length,
    outcome: entries.get(keyOf(startState)),
    counts,
    entries,
  };

  function addState(state, knownKey) {
    const key = knownKey ?? keyOf(state);
    const index = states.length;
    states.push(state);
    keys.push(key);
    successors.push([]);
    predecessors.push([]);
    indexByKey.set(key, index);
    return index;
  }
}

function terminalOutcome(state) {
  if (state.winner === "DRAW") return 0;
  return state.winner === state.turn ? 1 : -1;
}

