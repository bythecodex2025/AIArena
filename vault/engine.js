export const RULES_VERSION = "1.0.0";
export const SYMBOLS = Object.freeze(["△", "○", "□", "◇"]);
export const MAX_GUESSES = 6;
export const MAX_PLIES = MAX_GUESSES * 2;

export const ALL_CODES = Object.freeze(permutations(SYMBOLS, 3).map((code) => Object.freeze(code)));

export function initialState({ seed = 20260814, forceFirst } = {}) {
  const first = forceFirst ?? ((seed >>> 0) % 2 === 0 ? "P1" : "P2");
  return {
    gameId: "echo-vault",
    rulesVersion: RULES_VERSION,
    seed: seed >>> 0,
    ply: 0,
    maxPlies: MAX_PLIES,
    currentPlayer: first,
    secrets: {
      P1: secretFromSeed(seed, 0x9e3779b9),
      P2: secretFromSeed(seed, 0x85ebca6b),
    },
    histories: { P1: [], P2: [] },
    pendingWinner: null,
    winner: null,
    reason: null,
    lastActions: [],
  };
}

export function cloneState(state) { return JSON.parse(JSON.stringify(state)); }

export function legalActions(state, player = state.currentPlayer) {
  if (outcome(state) || player !== state.currentPlayer) return [];
  const used = new Set(state.histories[player].map((entry) => entry.code.join("")));
  return ALL_CODES.filter((code) => !used.has(code.join(""))).map((code) => ({
    id: `probe:${code.join("")}`,
    type: "probe",
    code: [...code],
  }));
}

export function applyAction(state, requested) {
  const actionId = typeof requested === "string" ? requested : requested?.id;
  const action = legalActions(state).find((item) => item.id === actionId);
  if (!action) throw new Error(`불법 행동: ${actionId ?? "undefined"}`);
  const next = cloneState(state);
  const player = next.currentPlayer;
  const target = otherPlayer(player);
  const result = feedback(action.code, next.secrets[target]);
  next.histories[player].push({ code: [...action.code], ...result });
  next.ply += 1;
  next.lastActions = [{ player, actionId: action.id, text: `${action.code.join(" ")} → 정확 ${result.exact} · 위치 다름 ${result.near}` }];
  if (result.exact === 3) {
    if (next.pendingWinner && next.pendingWinner !== player) {
      next.winner = null;
      next.reason = "같은 라운드에 양쪽 모두 암호를 해독해 무승부입니다.";
    } else if (next.histories[target].length < next.histories[player].length && next.histories[target].length < MAX_GUESSES) {
      next.pendingWinner = player;
      next.currentPlayer = target;
    } else {
      next.winner = player;
      next.reason = `${player}이 ${target}의 암호를 해독했습니다.`;
    }
    return next;
  }
  if (next.pendingWinner) {
    next.winner = next.pendingWinner;
    next.reason = `${next.pendingWinner}이 상대의 마지막 응답을 막고 암호 해독에 성공했습니다.`;
    return next;
  }
  if (next.ply >= next.maxPlies || bothFinished(next)) {
    settleByInformation(next);
    return next;
  }
  next.currentPlayer = otherPlayer(player);
  if (next.histories[next.currentPlayer].length >= MAX_GUESSES) next.currentPlayer = player;
  return next;
}

export function feedback(guess, secret) {
  let exact = 0;
  for (let index = 0; index < 3; index += 1) if (guess[index] === secret[index]) exact += 1;
  const shared = guess.filter((symbol) => secret.includes(symbol)).length;
  return { exact, near: shared - exact };
}

export function candidateCodes(history) {
  return ALL_CODES.filter((candidate) => history.every((entry) => {
    const result = feedback(entry.code, candidate);
    return result.exact === entry.exact && result.near === entry.near;
  }));
}

export function outcome(state) {
  if (state.reason) return { winner: state.winner, reason: state.reason };
  return null;
}

export function publicState(state, viewer = state.currentPlayer) {
  return {
    gameId: state.gameId,
    rulesVersion: state.rulesVersion,
    seed: state.seed,
    ply: state.ply,
    maxPlies: state.maxPlies,
    currentPlayer: state.currentPlayer,
    ownSecret: [...state.secrets[viewer]],
    histories: cloneState(state.histories),
    remainingCandidates: {
      P1: candidateCodes(state.histories.P1).length,
      P2: candidateCodes(state.histories.P2).length,
    },
    pendingWinner: state.pendingWinner,
    lastActions: cloneState(state.lastActions),
    legalActions: legalActions(state, viewer),
  };
}

export function actionText(action) { return `${action.code.join(" ")} 탐색`; }
export function turnLabel(state) { return outcome(state) ? "해독 종료" : `${state.currentPlayer} · ${state.ply + 1}/${state.maxPlies} 탐색`; }
export function progress(state) { return state.ply / state.maxPlies; }
export function stateKey(state) { return JSON.stringify([state.currentPlayer, state.histories, state.winner]); }

function settleByInformation(state) {
  const remaining = {
    P1: candidateCodes(state.histories.P1).length,
    P2: candidateCodes(state.histories.P2).length,
  };
  if (remaining.P1 !== remaining.P2) {
    state.winner = remaining.P1 < remaining.P2 ? "P1" : "P2";
    state.reason = `${state.winner}이 후보를 ${Math.min(remaining.P1, remaining.P2)}개까지 좁혀 정보전에서 승리했습니다.`;
    return;
  }
  const signal = Object.fromEntries(["P1", "P2"].map((player) => [player, state.histories[player].reduce((sum, entry) => sum + entry.exact * 3 + entry.near, 0)]));
  state.winner = signal.P1 === signal.P2 ? null : signal.P1 > signal.P2 ? "P1" : "P2";
  state.reason = state.winner ? `${state.winner}이 더 강한 일치 신호로 승리했습니다.` : "후보 수와 일치 신호가 같아 무승부입니다.";
}

function bothFinished(state) { return state.histories.P1.length >= MAX_GUESSES && state.histories.P2.length >= MAX_GUESSES; }
function otherPlayer(player) { return player === "P1" ? "P2" : "P1"; }
function secretFromSeed(seed, salt) { const random = mulberry32((seed ^ salt) >>> 0); return [...ALL_CODES[Math.floor(random() * ALL_CODES.length)]]; }
function mulberry32(seed) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let value = Math.imul(seed ^ seed >>> 15, 1 | seed); value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value; return ((value ^ value >>> 14) >>> 0) / 4294967296; }; }
function permutations(items, length, prefix = []) { if (prefix.length === length) return [prefix]; return items.flatMap((item) => prefix.includes(item) ? [] : permutations(items, length, [...prefix, item])); }
