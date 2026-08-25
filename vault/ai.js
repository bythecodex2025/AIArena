import { ALL_CODES, candidateCodes, feedback, legalActions, publicState } from "./engine.js";

export const AI_LEVELS = Object.freeze({
  v1: { name: "V1 노이즈 리더", description: "재현 가능한 무작위 탐색" },
  v2: { name: "V2 후보 추적자", description: "가능한 암호만 순서대로 탐색" },
  v3: { name: "V3 분할 분석가", description: "최악의 후보군을 줄이는 탐색" },
  v4: { name: "V4 엔트로피 해커", description: "피드백 정보량 최대화" },
  v5: { name: "V5 볼트 브레이커", description: "전 후보 미니맥스 분할" },
});

export function chooseAction(state, level = "v3") {
  const started = now();
  const view = publicState(state, state.currentPlayer);
  const actions = legalActions(state);
  const candidates = candidateCodes(view.histories[state.currentPlayer]);
  let action = actions[0];
  let nodes = actions.length;
  if (level === "v1") action = actions[(state.seed + state.ply * 11) % actions.length];
  if (level === "v2") action = actions.find((item) => candidates.some((code) => sameCode(item.code, code))) ?? actions[0];
  if (level === "v3") action = bestPartition(actions.filter((item) => candidates.some((code) => sameCode(item.code, code))), candidates, "worst") ?? actions[0];
  if (level === "v4") action = bestPartition(actions, candidates, "entropy") ?? actions[0];
  if (level === "v5") action = bestPartition(actions, candidates, "minimax") ?? actions[0];
  nodes += actions.length * Math.max(1, candidates.length);
  return { action, stats: { level, nodes, depth: level === "v1" ? 1 : 2, elapsedMs: Math.round((now() - started) * 10) / 10 } };
}

function bestPartition(actions, candidates, mode) {
  let best = null;
  for (const action of actions) {
    const buckets = new Map();
    for (const secret of candidates) {
      const result = feedback(action.code, secret);
      const key = `${result.exact}:${result.near}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const counts = [...buckets.values()];
    const worst = Math.max(...counts, 0);
    const entropy = counts.reduce((sum, count) => { const p = count / Math.max(1, candidates.length); return sum - p * Math.log2(p); }, 0);
    const possible = candidates.some((code) => sameCode(code, action.code)) ? 1 : 0;
    const score = mode === "entropy" ? entropy * 100 + possible : -worst * 100 + buckets.size * 2 + possible;
    if (!best || score > best.score) best = { action, score };
  }
  return best?.action ?? null;
}

function sameCode(left, right) { return left.every((symbol, index) => symbol === right[index]); }
function now() { return globalThis.performance?.now?.() ?? Date.now(); }
