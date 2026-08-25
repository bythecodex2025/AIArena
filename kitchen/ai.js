import { INGREDIENTS, legalActions, publicState } from "./engine.js";

export const AI_LEVELS = Object.freeze({
  v1: { name: "V1 배고픈 로봇", description: "재현 가능한 무작위 행동" },
  v2: { name: "V2 레시피 조수", description: "즉시 완성 가능한 최고 점수" },
  v3: { name: "V3 팬트리 플래너", description: "부족 재료와 열을 함께 계산" },
  v4: { name: "V4 콤보 셰프", description: "맛 태그 콤보와 주문 선점" },
  v5: { name: "V5 오비트 마스터", description: "점수 효율과 다음 조리를 통합" },
});

export function chooseAction(state, level = "v3") {
  const started = now();
  const view = publicState(state, state.currentPlayer);
  const actions = legalActions(state);
  let action = actions[0];
  if (level === "v1") action = actions[(state.seed + state.ply * 7) % actions.length];
  else action = [...actions].sort((left, right) => score(right, view, level) - score(left, view, level) || left.id.localeCompare(right.id))[0];
  return { action, stats: { level, nodes: actions.length * (level === "v5" ? view.orders.length + 1 : 1), depth: level === "v5" ? 3 : level === "v4" ? 2 : 1, elapsedMs: Math.round((now() - started) * 10) / 10 } };
}

function score(action, view, level) {
  const chef = view.chefs[view.currentPlayer];
  if (action.type === "cook") {
    const combo = chef.lastTag && chef.lastTag !== action.tag ? Math.min(3, chef.combo + 1) : 0;
    let value = action.value * 12 + combo * (level === "v4" || level === "v5" ? 9 : 3) - action.heat * 2 + (action.seasoned ? 8 : 0);
    const opponent = view.chefs[view.currentPlayer === "P1" ? "P2" : "P1"];
    const order = view.orders.find((item) => item.orderId === action.orderId);
    if (order && Object.entries(order.cost).every(([key, amount]) => opponent.pantry[key] >= amount)) value += level === "v4" || level === "v5" ? 10 : 0;
    return value;
  }
  if (action.type === "cool") return chef.heat >= 4 ? 34 : chef.heat * 5;
  const need = view.orders.reduce((sum, order) => sum + Math.max(0, (order.cost[action.ingredient] ?? 0) - chef.pantry[action.ingredient]), 0);
  const versatility = view.orders.filter((order) => order.cost[action.ingredient]).length;
  return 12 + need * (level === "v3" || level === "v5" ? 10 : 4) + versatility * 3 - chef.pantry[action.ingredient] * 2;
}

function now() { return globalThis.performance?.now?.() ?? Date.now(); }
