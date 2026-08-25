export const GAME_ID = "relay-forge";
export const RULES_VERSION = "1.2.0";
export const BOARD_WIDTH = 5;
export const BOARD_HEIGHT = 5;
export const MAX_PLIES = 48;
export const RELAY_POSITIONS = Object.freeze([5, 12, 19]);
export const RELAY_MIN_INFLUENCE = 2;
export const SIGNAL_TARGET = 5;
export const CORE_POSITIONS = Object.freeze({ P1: 22, P2: 2 });
export const ACTION_COSTS = Object.freeze({ extend: 1, overload: 2, fortify: 2, hack: 3, swap: 0, wait: 0, settle: 0 });

export function otherPlayer(player) {
  return player === "P1" ? "P2" : "P1";
}

export function initialState() {
  const state = {
    gameId: GAME_ID,
    rulesVersion: RULES_VERSION,
    boardWidth: BOARD_WIDTH,
    boardHeight: BOARD_HEIGHT,
    ply: 0,
    maxPlies: MAX_PLIES,
    currentPlayer: "P1",
    // 초기 에너지 2에 P1의 첫 행동 시작 충전 1을 적용한 행동 가능 상태다.
    energy: { P1: 3, P2: 2 },
    signalScores: { P1: 0, P2: 0 },
    cores: [
      { id: "P1-core", owner: "P1", position: CORE_POSITIONS.P1 },
      { id: "P2-core", owner: "P2", position: CORE_POSITIONS.P2 },
    ],
    nodes: [
      node("P1-n1", "P1", 21), node("P1-n2", "P1", 23),
      node("P2-n1", "P2", 1), node("P2-n2", "P2", 3),
    ],
    nextNodeIds: { P1: 3, P2: 3 },
    lastActions: [],
    winner: null,
    reason: null,
    repetitions: {},
  };
  state.repetitions[stateKey(state)] = 1;
  return state;
}

export function node(id, owner, position, fortified = false) {
  return { id, owner, position, fortified };
}

export function cloneState(state) {
  return {
    gameId: state.gameId ?? GAME_ID,
    rulesVersion: state.rulesVersion ?? RULES_VERSION,
    boardWidth: BOARD_WIDTH,
    boardHeight: BOARD_HEIGHT,
    ply: state.ply ?? 0,
    maxPlies: state.maxPlies ?? MAX_PLIES,
    currentPlayer: state.currentPlayer,
    energy: { ...state.energy },
    signalScores: { ...(state.signalScores ?? state.signalStreaks ?? { P1: 0, P2: 0 }) },
    cores: state.cores.map((item) => ({ ...item })),
    nodes: state.nodes.map((item) => ({ ...item })),
    nextNodeIds: { ...(state.nextNodeIds ?? inferNextNodeIds(state.nodes)) },
    lastActions: (state.lastActions ?? []).map((item) => ({ ...item })),
    winner: state.winner ?? null,
    reason: state.reason ?? null,
    repetitions: { ...(state.repetitions ?? {}) },
  };
}

export function rowCol(position) {
  return [Math.floor(position / BOARD_WIDTH), position % BOARD_WIDTH];
}

export function coordinate(position) {
  const [row, column] = rowCol(position);
  return `${String.fromCharCode(65 + column)}${row + 1}`;
}

export function neighbors(position) {
  const [row, column] = rowCol(position);
  const result = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nextRow = row + dr;
    const nextColumn = column + dc;
    if (nextRow >= 0 && nextRow < BOARD_HEIGHT && nextColumn >= 0 && nextColumn < BOARD_WIDTH) {
      result.push(nextRow * BOARD_WIDTH + nextColumn);
    }
  }
  return result;
}

export function poweredNodeIds(state, player) {
  const ownByPosition = new Map(
    state.nodes.filter((item) => item.owner === player).map((item) => [item.position, item]),
  );
  const visitedPositions = new Set([CORE_POSITIONS[player]]);
  const powered = new Set();
  const queue = [CORE_POSITIONS[player]];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const position of neighbors(queue[cursor])) {
      if (visitedPositions.has(position)) continue;
      const found = ownByPosition.get(position);
      if (!found) continue;
      visitedPositions.add(position);
      powered.add(found.id);
      queue.push(position);
    }
  }
  return powered;
}

export function relayControl(state) {
  const powered = {
    P1: poweredNodeIds(state, "P1"),
    P2: poweredNodeIds(state, "P2"),
  };
  return RELAY_POSITIONS.map((position) => {
    const influence = { P1: 0, P2: 0 };
    for (const neighbor of neighbors(position)) {
      const nodeAtNeighbor = state.nodes.find((item) => item.position === neighbor);
      if (nodeAtNeighbor && powered[nodeAtNeighbor.owner].has(nodeAtNeighbor.id)) influence[nodeAtNeighbor.owner] += 1;
    }
    const strongest = Math.max(influence.P1, influence.P2);
    const owner = strongest < RELAY_MIN_INFLUENCE || influence.P1 === influence.P2
      ? null
      : influence.P1 > influence.P2 ? "P1" : "P2";
    return { position, owner, influence };
  });
}

export function legalActions(state, player = state.currentPlayer) {
  if (state.winner || player !== state.currentPlayer) return [];
  const energy = state.energy[player];
  const opponent = otherPlayer(player);
  const powered = poweredNodeIds(state, player);
  const ownPowered = state.nodes.filter((item) => item.owner === player && powered.has(item.id));
  const poweredPositions = new Set([CORE_POSITIONS[player], ...ownPowered.map((item) => item.position)]);
  const occupied = new Set([
    ...state.cores.map((item) => item.position),
    ...state.nodes.map((item) => item.position),
    ...RELAY_POSITIONS,
  ]);
  const actions = [];

  // 파이 룰: 선공의 첫 행동이 지나치게 좋다면 후공이 그 결과를 넘겨받을 수 있다.
  if (state.ply === 1 && player === "P2") {
    actions.push({ id: "swap", type: "swap", cost: ACTION_COSTS.swap });
  }

  if (energy >= ACTION_COSTS.extend) {
    const destinations = new Set();
    for (const position of poweredPositions) {
      for (const target of neighbors(position)) if (!occupied.has(target)) destinations.add(target);
    }
    for (const to of [...destinations].sort((left, right) => left - right)) {
      actions.push({ id: `extend:${to}`, type: "extend", to, cost: ACTION_COSTS.extend });
    }
  }

  if (energy >= ACTION_COSTS.overload) {
    for (const target of state.nodes.filter((item) => item.owner === opponent).sort(byId)) {
      const surround = neighbors(target.position).filter((position) => poweredPositions.has(position)).length;
      const required = target.fortified ? 3 : 2;
      if (surround >= required) {
        actions.push({
          id: `overload:${target.id}`,
          type: "overload",
          targetId: target.id,
          cost: ACTION_COSTS.overload,
        });
      }
    }
  }

  if (energy >= ACTION_COSTS.fortify) {
    for (const target of ownPowered.filter((item) => !item.fortified).sort(byId)) {
      actions.push({
        id: `fortify:${target.id}`,
        type: "fortify",
        nodeId: target.id,
        cost: ACTION_COSTS.fortify,
      });
    }
  }

  if (energy >= ACTION_COSTS.hack) {
    const enemyCore = CORE_POSITIONS[opponent];
    if (neighbors(enemyCore).some((position) => ownPowered.some((item) => item.position === position))) {
      actions.push({
        id: `hack:${opponent}-core`,
        type: "hack",
        targetId: `${opponent}-core`,
        cost: ACTION_COSTS.hack,
      });
    }
  }

  actions.push({ id: "wait", type: "wait", cost: ACTION_COSTS.wait });

  // 전체 상태 초패(superko): 과거의 보드·자원·차례를 그대로 재현하는 수는 둘 수 없다.
  // 과부하와 재설치, 또는 무의미한 대기가 영구 반복되는 것을 합법 행동 단계에서 차단한다.
  const freshActions = actions.filter((action) => {
    const preview = applyAction(state, action, { validate: false, trackRepetition: false });
    if (preview.winner) return true;
    return !state.repetitions[stateKey(preview)];
  });
  return freshActions.length
    ? freshActions
    : [{ id: "settle", type: "settle", cost: ACTION_COSTS.settle }];
}

export function applyAction(state, requestedAction, { validate = true, trackRepetition = true } = {}) {
  if (state.winner) throw new Error("이미 끝난 경기입니다.");
  const requestedId = typeof requestedAction === "string" ? requestedAction : requestedAction?.id;
  const action = validate ? legalActions(state).find((candidate) => candidate.id === requestedId) : requestedAction;
  if (!action) throw new Error("합법 행동이 아닙니다.");

  const next = cloneState(state);
  const player = next.currentPlayer;
  const opponent = otherPlayer(player);

  if (action.type === "swap") return applyOpeningSwap(next);
  if (action.type === "settle") {
    next.ply += 1;
    next.lastActions = [{ player, actionId: "settle", type: "settle", text: `${player} 교착 상태 정산` }];
    applyScoreOutcome(next, "교착 정산");
    return next;
  }

  next.energy[player] -= action.cost ?? ACTION_COSTS[action.type];
  let text;

  if (action.type === "extend") {
    const id = `${player}-n${next.nextNodeIds[player]++}`;
    next.nodes.push(node(id, player, action.to));
    text = `${player} 노드 설치 · ${coordinate(action.to)}`;
  } else if (action.type === "overload") {
    const target = next.nodes.find((item) => item.id === action.targetId);
    next.nodes = next.nodes.filter((item) => item.id !== action.targetId);
    text = `${player} 적 노드 제거 · ${coordinate(target.position)}`;
  } else if (action.type === "fortify") {
    const target = next.nodes.find((item) => item.id === action.nodeId);
    target.fortified = true;
    text = `${player} 노드 방어 · ${coordinate(target.position)}`;
  } else if (action.type === "hack") {
    text = `${player} 기지 해킹 · ${opponent}`;
  } else {
    text = `${player} 대기`;
  }

  next.ply += 1;
  next.lastActions = [{ player, actionId: action.id, type: action.type, text }];

  if (action.type === "hack") {
    next.winner = player;
    next.reason = `${opponent} 기지를 해킹했습니다.`;
    return next;
  }

  // 각자 자기 행동 직후의 점령 상태로 한 번씩 득점하되, 승부는 P2의 응답까지 끝난
  // 라운드 경계에서만 판정한다. 양쪽에 같은 수의 득점 기회를 보장하기 위함이다.
  const controls = relayControl(next);
  next.signalScores[player] += controls.filter((relay) => relay.owner === player).length;
  if (player === "P2") {
    const reached = ["P1", "P2"].filter((side) => next.signalScores[side] >= SIGNAL_TARGET);
    if (reached.length) {
      if (reached.length === 2 && next.signalScores.P1 === next.signalScores.P2) {
        next.winner = "DRAW";
        next.reason = `같은 라운드에 중계기 신호 ${SIGNAL_TARGET}점을 함께 달성했습니다.`;
      } else {
        next.winner = reached.length === 1
          ? reached[0]
          : next.signalScores.P1 > next.signalScores.P2 ? "P1" : "P2";
        next.reason = `중계기 신호 ${SIGNAL_TARGET}점을 먼저 모았습니다.`;
      }
      return next;
    }
  }

  next.currentPlayer = opponent;

  // 마지막 행동 뒤에는 존재하지 않는 다음 턴의 에너지를 미리 지급하지 않는다.
  // 그렇지 않으면 짝수 반수 종료 시 항상 P1이 에너지 동점 판정에서 유리해진다.
  if (next.ply >= next.maxPlies) {
    applyMaxPlyOutcome(next);
    return next;
  }

  next.energy[opponent] = Math.min(4, next.energy[opponent] + 1);

  if (trackRepetition) {
    const key = stateKey(next);
    next.repetitions[key] = (next.repetitions[key] ?? 0) + 1;
    if (next.repetitions[key] >= 2) {
      next.winner = "DRAW";
      next.reason = "이미 나온 전체 상태가 다시 만들어졌습니다.";
      return next;
    }
  }

  return next;
}

export function outcome(state) {
  if (!state.winner) return null;
  return {
    winner: state.winner === "DRAW" ? null : state.winner,
    reason: state.reason,
  };
}

export function publicState(state) {
  const powered = {
    P1: poweredNodeIds(state, "P1"),
    P2: poweredNodeIds(state, "P2"),
  };
  return {
    gameId: GAME_ID,
    rulesVersion: RULES_VERSION,
    boardWidth: BOARD_WIDTH,
    boardHeight: BOARD_HEIGHT,
    ply: state.ply,
    maxPlies: state.maxPlies,
    currentPlayer: state.currentPlayer,
    energy: { ...state.energy },
    signalScores: { ...state.signalScores },
    cores: state.cores.map((item) => ({ ...item })),
    nodes: state.nodes.map((item) => ({
      ...item,
      powered: powered[item.owner].has(item.id),
    })),
    relays: relayControl(state),
    lastActions: state.lastActions.map((item) => ({ ...item })),
    legalActions: legalActions(state).map((action) => ({ ...action })),
  };
}

export function stateKey(state) {
  const board = Array.from({ length: BOARD_WIDTH * BOARD_HEIGHT }, () => "0");
  board[CORE_POSITIONS.P1] = "1C";
  board[CORE_POSITIONS.P2] = "2C";
  for (const item of state.nodes) {
    board[item.position] = `${item.owner === "P1" ? "1" : "2"}${item.fortified ? "F" : "N"}`;
  }
  return [
    state.currentPlayer,
    board.join("."),
    `${state.energy.P1},${state.energy.P2}`,
    `${state.signalScores.P1},${state.signalScores.P2}`,
  ].join("|");
}

export function actionText(state, action) {
  if (!action) return "—";
  if (action.type === "extend") return `연결 ${coordinate(action.to)}`;
  if (action.type === "overload") {
    const target = state.nodes.find((item) => item.id === action.targetId);
    return `과부하 ${target ? coordinate(target.position) : action.targetId}`;
  }
  if (action.type === "fortify") {
    const target = state.nodes.find((item) => item.id === action.nodeId);
    return `강화 ${target ? coordinate(target.position) : action.nodeId}`;
  }
  if (action.type === "hack") return "상대 코어 해킹";
  if (action.type === "swap") return "첫 행동 진영 교환";
  if (action.type === "settle") return "교착 상태 정산";
  return "대기";
}

export function assertValidState(state) {
  if (state.gameId !== GAME_ID) throw new Error("gameId가 올바르지 않습니다.");
  if (!["P1", "P2"].includes(state.currentPlayer)) throw new Error("현재 플레이어가 올바르지 않습니다.");
  const occupied = new Set(state.cores.map((item) => item.position));
  for (const item of state.nodes) {
    if (!Number.isInteger(item.position) || item.position < 0 || item.position >= 25) throw new Error("노드 위치가 올바르지 않습니다.");
    if (RELAY_POSITIONS.includes(item.position)) throw new Error("중앙 중계기에는 노드를 놓을 수 없습니다.");
    if (occupied.has(item.position)) throw new Error("한 칸에 둘 이상의 객체가 있습니다.");
    occupied.add(item.position);
  }
  for (const side of ["P1", "P2"]) {
    if (!Number.isInteger(state.energy[side]) || state.energy[side] < 0 || state.energy[side] > 4) throw new Error("에너지가 올바르지 않습니다.");
    if (!Number.isInteger(state.signalScores[side]) || state.signalScores[side] < 0) throw new Error("신호 점수가 올바르지 않습니다.");
  }
  return true;
}

function applyMaxPlyOutcome(state) {
  applyScoreOutcome(state, "48반수");
}

function applyScoreOutcome(state, label) {
  const controls = relayControl(state);
  const powered = {
    P1: poweredNodeIds(state, "P1").size,
    P2: poweredNodeIds(state, "P2").size,
  };
  const metrics = [
    [state.signalScores, `${label} 신호 점수 우위`],
    [{
      P1: controls.filter((relay) => relay.owner === "P1").length,
      P2: controls.filter((relay) => relay.owner === "P2").length,
    }, `${label} 릴레이 우위`],
    [powered, `${label} 전력 노드 우위`],
    [{
      P1: state.nodes.filter((item) => item.owner === "P1").length,
      P2: state.nodes.filter((item) => item.owner === "P2").length,
    }, `${label} 전체 노드 우위`],
    [state.energy, `${label} 에너지 우위`],
  ];
  for (const [values, reason] of metrics) {
    if (values.P1 === values.P2) continue;
    state.winner = values.P1 > values.P2 ? "P1" : "P2";
    state.reason = reason;
    return;
  }
  state.winner = "DRAW";
  state.reason = `${label} 완전 동률입니다.`;
}

function applyOpeningSwap(state) {
  const swapOwner = (owner) => owner === "P1" ? "P2" : "P1";
  const swapId = (id) => id.replace(/^P1-/, "TEMP-").replace(/^P2-/, "P1-").replace(/^TEMP-/, "P2-");
  state.cores = state.cores.map((item) => ({
    ...item,
    id: swapId(item.id),
    owner: swapOwner(item.owner),
    position: 24 - item.position,
  })).sort((left, right) => left.owner.localeCompare(right.owner));
  state.nodes = state.nodes.map((item) => ({
    ...item,
    id: swapId(item.id),
    owner: swapOwner(item.owner),
    position: 24 - item.position,
  }));
  state.energy = { P1: state.energy.P2, P2: state.energy.P1 };
  state.signalScores = { P1: state.signalScores.P2, P2: state.signalScores.P1 };
  state.nextNodeIds = { P1: state.nextNodeIds.P2, P2: state.nextNodeIds.P1 };
  state.ply += 1;
  state.currentPlayer = "P1";
  state.lastActions = [{ player: "P2", actionId: "swap", type: "swap", text: "P2 첫 행동 진영 교환" }];
  state.repetitions = {};
  state.repetitions[stateKey(state)] = 1;
  return state;
}

function inferNextNodeIds(nodes) {
  const result = { P1: 1, P2: 1 };
  for (const item of nodes) {
    const match = item.id.match(/^(P[12])-n(\d+)$/);
    if (match) result[match[1]] = Math.max(result[match[1]], Number(match[2]) + 1);
  }
  return result;
}

function byId(left, right) {
  return left.id.localeCompare(right.id);
}
