export const GAME_ID = "starlight-auction";
export const RULES_VERSION = "1.0.0";
export const MAX_LOTS = 8;
export const MAX_PLIES = 96;
export const STARTING_CREDITS = 22;
export const STARTING_FAVOR = 2;
export const SUITS = Object.freeze(["SOLAR", "LUNAR", "NOVA"]);

export const SUIT_INFO = Object.freeze({
  SOLAR: { name: "태양 왕조", symbol: "☀" },
  LUNAR: { name: "달의 기록", symbol: "◐" },
  NOVA: { name: "초신성 공예", symbol: "✦" },
});

export const PATRONS = Object.freeze({
  curator: { id: "curator", name: "세트 수집가", description: "3종 세트가 7점입니다.", setBonus: 7, majorityBonus: 3, creditDivisor: 3 },
  critic: { id: "critic", name: "유행 평론가", description: "분야별 다수 보너스가 5점입니다.", setBonus: 5, majorityBonus: 5, creditDivisor: 3 },
  broker: { id: "broker", name: "냉정한 중개인", description: "남은 크레딧 5개마다 2점입니다.", setBonus: 5, majorityBonus: 3, creditDivisor: 2.5 },
});

export const ARTIFACTS = Object.freeze([
  artifact("solar-crown", "일광 왕관", "SOLAR", 5, null),
  artifact("solar-map", "황금 항로도", "SOLAR", 4, "favor"),
  artifact("solar-coin", "새벽 주화", "SOLAR", 3, "refund"),
  artifact("solar-seal", "붉은 봉인", "SOLAR", 2, "refund"),
  artifact("lunar-clock", "월식 시계", "LUNAR", 5, null),
  artifact("lunar-book", "밤의 장부", "LUNAR", 4, "favor"),
  artifact("lunar-mask", "은빛 가면", "LUNAR", 3, "refund"),
  artifact("lunar-lens", "푸른 관측경", "LUNAR", 2, "favor"),
  artifact("nova-heart", "성운의 심장", "NOVA", 5, null),
  artifact("nova-engine", "혜성 기관", "NOVA", 4, "refund"),
  artifact("nova-vase", "무중력 화병", "NOVA", 3, "favor"),
  artifact("nova-key", "별문 열쇠", "NOVA", 2, "refund"),
]);

export function otherPlayer(player) {
  return player === "P1" ? "P2" : "P1";
}

export function initialState({ seed = 20260813, maxLots = MAX_LOTS } = {}) {
  const deck = shuffle(ARTIFACTS.map((item) => ({ ...item })), seed);
  return {
    gameId: GAME_ID,
    rulesVersion: RULES_VERSION,
    seed,
    phase: "patron",
    ply: 0,
    maxPlies: MAX_PLIES,
    maxLots: Math.max(3, Math.min(maxLots, deck.length)),
    currentPlayer: "P1",
    patrons: { P1: null, P2: null },
    credits: { P1: STARTING_CREDITS, P2: STARTING_CREDITS },
    favor: { P1: STARTING_FAVOR, P2: STARTING_FAVOR },
    collections: { P1: [], P2: [] },
    deck,
    lotIndex: 0,
    currentLot: null,
    nextLot: null,
    openingPlayer: null,
    highBid: 0,
    leader: null,
    leaderCost: 0,
    emptyPasses: 0,
    discarded: [],
    lastActions: [],
    winner: null,
    reason: null,
  };
}

export function cloneState(state) {
  return {
    ...state,
    patrons: { ...state.patrons },
    credits: { ...state.credits },
    favor: { ...state.favor },
    collections: {
      P1: state.collections.P1.map((item) => ({ ...item })),
      P2: state.collections.P2.map((item) => ({ ...item })),
    },
    deck: state.deck.map((item) => ({ ...item })),
    currentLot: state.currentLot ? { ...state.currentLot } : null,
    nextLot: state.nextLot ? { ...state.nextLot } : null,
    discarded: state.discarded.map((item) => ({ ...item })),
    lastActions: state.lastActions.map((item) => ({ ...item })),
  };
}

export function legalActions(state, player = state.currentPlayer) {
  if (state.winner || player !== state.currentPlayer) return [];
  if (state.phase === "patron") {
    return Object.values(PATRONS).map((patron) => ({
      id: `patron:${patron.id}`,
      type: "patron",
      patronId: patron.id,
    }));
  }
  if (state.phase !== "auction" || !state.currentLot) return [];

  const actions = [];
  const minimum = state.highBid + 1;
  const maximum = Math.min(state.highBid + 3, state.credits[player]);
  for (let offer = minimum; offer <= maximum; offer += 1) {
    actions.push({ id: `bid:${offer}`, type: "bid", offer, payment: offer, useFavor: false });
  }
  if (state.favor[player] > 0) {
    const favorMinimum = state.highBid + 2;
    const favorMaximum = Math.min(state.highBid + 4, state.credits[player] + 1);
    for (let offer = favorMinimum; offer <= favorMaximum; offer += 1) {
      actions.push({ id: `favor:${offer}`, type: "bid", offer, payment: offer - 1, useFavor: true });
    }
  }
  actions.push({ id: "pass", type: "pass" });
  return actions;
}

export function applyAction(state, requestedAction, { validate = true } = {}) {
  if (state.winner) throw new Error("이미 끝난 경매입니다.");
  const id = typeof requestedAction === "string" ? requestedAction : requestedAction?.id;
  const action = validate ? legalActions(state).find((item) => item.id === id) : requestedAction;
  if (!action) throw new Error("합법 행동이 아닙니다.");

  const next = cloneState(state);
  const player = next.currentPlayer;
  next.ply += 1;

  if (action.type === "patron") {
    next.patrons[player] = action.patronId;
    next.lastActions = [{ player, actionId: action.id, type: action.type, text: `${player} · ${PATRONS[action.patronId].name} 선택` }];
    if (player === "P1") next.currentPlayer = "P2";
    else beginLot(next);
  } else if (action.type === "bid") {
    next.highBid = action.offer;
    next.leader = player;
    next.leaderCost = action.payment;
    if (action.useFavor) next.favor[player] -= 1;
    next.emptyPasses = 0;
    next.currentPlayer = otherPlayer(player);
    next.lastActions = [{
      player,
      actionId: action.id,
      type: action.type,
      text: `${player} · ${action.offer} 입찰${action.useFavor ? ` (영향력, 지불 ${action.payment})` : ""}`,
    }];
  } else if (action.type === "pass") {
    if (next.leader) {
      const winner = next.leader;
      const lot = { ...next.currentLot };
      next.credits[winner] -= next.leaderCost;
      next.collections[winner].push(lot);
      if (lot.ability === "refund") next.credits[winner] += 2;
      if (lot.ability === "favor") next.favor[winner] = Math.min(4, next.favor[winner] + 1);
      next.lastActions = [{
        player,
        actionId: action.id,
        type: action.type,
        text: `${player} 패스 · ${winner}이(가) ${lot.name} 낙찰 (${next.leaderCost})`,
      }];
      advanceLot(next);
    } else {
      next.emptyPasses += 1;
      next.lastActions = [{ player, actionId: action.id, type: action.type, text: `${player} · 무입찰 패스` }];
      if (next.emptyPasses >= 2) {
        next.discarded.push({ ...next.currentLot });
        advanceLot(next);
      } else {
        next.currentPlayer = otherPlayer(player);
      }
    }
  }

  if (!next.winner && next.ply >= next.maxPlies) applyFinalOutcome(next, "최대 행동 수 정산");
  return next;
}

export function scoreBreakdown(state) {
  const counts = {
    P1: suitCounts(state.collections.P1),
    P2: suitCounts(state.collections.P2),
  };
  const result = {};
  for (const player of ["P1", "P2"]) {
    const patron = PATRONS[state.patrons[player]] ?? PATRONS.curator;
    const base = state.collections[player].reduce((sum, item) => sum + item.value, 0);
    const sets = Math.min(...SUITS.map((suit) => counts[player][suit]));
    const majorities = SUITS.filter((suit) => counts[player][suit] > counts[otherPlayer(player)][suit]);
    const setPoints = sets * patron.setBonus;
    const majorityPoints = majorities.length * patron.majorityBonus;
    const creditPoints = Math.floor(state.credits[player] / patron.creditDivisor);
    result[player] = {
      base,
      sets,
      setPoints,
      majorities,
      majorityPoints,
      creditPoints,
      total: base + setPoints + majorityPoints + creditPoints,
      counts: { ...counts[player] },
    };
  }
  return result;
}

export function publicState(state) {
  return {
    gameId: GAME_ID,
    rulesVersion: RULES_VERSION,
    seed: state.seed,
    phase: state.phase,
    ply: state.ply,
    maxPlies: state.maxPlies,
    maxLots: state.maxLots,
    currentPlayer: state.currentPlayer,
    patrons: { ...state.patrons },
    patronOptions: Object.values(PATRONS).map((item) => ({ ...item })),
    credits: { ...state.credits },
    favor: { ...state.favor },
    collections: {
      P1: state.collections.P1.map((item) => ({ ...item })),
      P2: state.collections.P2.map((item) => ({ ...item })),
    },
    lotIndex: state.lotIndex,
    currentLot: state.currentLot ? { ...state.currentLot } : null,
    nextLot: state.nextLot ? { ...state.nextLot } : null,
    openingPlayer: state.openingPlayer,
    highBid: state.highBid,
    leader: state.leader,
    leaderCost: state.leaderCost,
    emptyPasses: state.emptyPasses,
    discardedCount: state.discarded.length,
    scores: scoreBreakdown(state),
    lastActions: state.lastActions.map((item) => ({ ...item })),
    legalActions: legalActions(state).map((item) => ({ ...item })),
  };
}

export function outcome(state) {
  if (!state.winner) return null;
  return { winner: state.winner === "DRAW" ? null : state.winner, reason: state.reason };
}

export function stateKey(state) {
  return JSON.stringify({
    phase: state.phase,
    ply: state.ply,
    currentPlayer: state.currentPlayer,
    patrons: state.patrons,
    credits: state.credits,
    favor: state.favor,
    collections: {
      P1: state.collections.P1.map((item) => item.id),
      P2: state.collections.P2.map((item) => item.id),
    },
    lotIndex: state.lotIndex,
    currentLot: state.currentLot?.id ?? null,
    highBid: state.highBid,
    leader: state.leader,
    leaderCost: state.leaderCost,
    emptyPasses: state.emptyPasses,
  });
}

export function actionText(action) {
  if (!action) return "—";
  if (action.type === "patron") return `후원자 · ${PATRONS[action.patronId]?.name ?? action.patronId}`;
  if (action.type === "bid") return `${action.offer} 입찰${action.useFavor ? ` · 영향력 사용 (지불 ${action.payment})` : ""}`;
  return "패스";
}

function beginLot(state) {
  state.phase = "auction";
  state.currentLot = { ...state.deck[state.lotIndex] };
  state.nextLot = state.lotIndex + 1 < state.maxLots ? { ...state.deck[state.lotIndex + 1] } : null;
  const seedStartsWithPlayerOne = (state.seed >>> 0) % 2 === 0;
  const evenLot = state.lotIndex % 2 === 0;
  state.openingPlayer = seedStartsWithPlayerOne === evenLot ? "P1" : "P2";
  state.currentPlayer = state.openingPlayer;
  state.highBid = 0;
  state.leader = null;
  state.leaderCost = 0;
  state.emptyPasses = 0;
}

function advanceLot(state) {
  state.lotIndex += 1;
  if (state.lotIndex >= state.maxLots) {
    applyFinalOutcome(state, `${state.maxLots}개 경매 종료`);
    return;
  }
  beginLot(state);
}

function applyFinalOutcome(state, label) {
  state.phase = "finished";
  state.currentLot = null;
  state.nextLot = null;
  state.highBid = 0;
  state.leader = null;
  state.leaderCost = 0;
  state.emptyPasses = 0;
  const scores = scoreBreakdown(state);
  if (scores.P1.total === scores.P2.total) {
    state.winner = "DRAW";
    state.reason = `${label} · ${scores.P1.total}점 완전 동률`;
  } else {
    state.winner = scores.P1.total > scores.P2.total ? "P1" : "P2";
    state.reason = `${label} · P1 ${scores.P1.total}점 : P2 ${scores.P2.total}점`;
  }
}

function suitCounts(collection) {
  return Object.fromEntries(SUITS.map((suit) => [suit, collection.filter((item) => item.suit === suit).length]));
}

function artifact(id, name, suit, value, ability) {
  return { id, name, suit, value, ability };
}

function shuffle(items, seed) {
  const result = [...items];
  const random = mulberry32(Number(seed) >>> 0);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function mulberry32(seed) {
  let value = seed || 1;
  return () => {
    value |= 0;
    value = value + 0x6D2B79F5 | 0;
    let next = Math.imul(value ^ value >>> 15, 1 | value);
    next = next + Math.imul(next ^ next >>> 7, 61 | next) ^ next;
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}
