export const RULES_VERSION = "1.0.0";
export const MAX_PLIES = 24;
export const INGREDIENTS = Object.freeze({
  algae: { name: "달빛 해조", icon: "◒", color: "green" },
  spice: { name: "태양 향신", icon: "✹", color: "orange" },
  crystal: { name: "혜성 결정", icon: "◆", color: "blue" },
});
export const RECIPES = Object.freeze([
  recipe("moon-broth", "문 브로스", { algae: 2, spice: 1 }, 5, 2, "savory"),
  recipe("comet-tart", "코멧 타르트", { crystal: 2, algae: 1 }, 6, 3, "sweet"),
  recipe("nebula-curry", "네뷸라 커리", { spice: 2, algae: 1 }, 6, 3, "spicy"),
  recipe("zero-salad", "제로G 샐러드", { algae: 2, crystal: 1 }, 5, 1, "fresh"),
  recipe("star-candy", "스타 캔디", { crystal: 2, spice: 1 }, 7, 2, "sweet"),
  recipe("ion-stew", "이온 스튜", { algae: 1, spice: 1, crystal: 1 }, 7, 3, "savory"),
  recipe("solar-noodle", "솔라 누들", { spice: 2, crystal: 1 }, 6, 2, "spicy"),
  recipe("orbit-pickle", "오비트 피클", { algae: 3 }, 5, 1, "fresh"),
  recipe("plasma-toast", "플라즈마 토스트", { spice: 1, crystal: 2 }, 6, 2, "savory"),
  recipe("aurora-jelly", "오로라 젤리", { algae: 1, crystal: 2 }, 6, 1, "sweet"),
  recipe("sunspot-soup", "선스폿 수프", { spice: 3 }, 6, 3, "spicy"),
  recipe("cosmo-roll", "코스모 롤", { algae: 2, spice: 1, crystal: 1 }, 8, 3, "fresh"),
]);

export function initialState({ seed = 20260814, forceFirst } = {}) {
  const shuffled = shuffle(RECIPES.map((item, index) => ({ ...item, orderId: `${item.id}-${index}` })), seed);
  return {
    gameId: "orbit-kitchen", rulesVersion: RULES_VERSION, seed: seed >>> 0, ply: 0, maxPlies: MAX_PLIES,
    currentPlayer: forceFirst ?? ((seed >>> 0) % 2 === 0 ? "P1" : "P2"),
    orders: shuffled.slice(0, 3), orderDeck: shuffled.slice(3),
    chefs: { P1: newChef(), P2: newChef() }, winner: null, reason: null, lastActions: [],
  };
}

export function cloneState(state) { return JSON.parse(JSON.stringify(state)); }

export function legalActions(state, player = state.currentPlayer) {
  if (outcome(state) || player !== state.currentPlayer) return [];
  const chef = state.chefs[player];
  const actions = [];
  for (const ingredient of Object.keys(INGREDIENTS)) {
    if (chef.pantry[ingredient] < 6) actions.push({ id: `gather:${ingredient}`, type: "gather", ingredient, amount: 2 });
  }
  for (const order of state.orders) {
    if (!canAfford(chef, order)) continue;
    if (chef.heat + order.heat <= 6) actions.push(cookAction(order, false));
    if (chef.season > 0 && chef.heat + Math.max(0, order.heat - 1) <= 6) actions.push(cookAction(order, true));
  }
  if (chef.heat > 0) actions.push({ id: "cool", type: "cool", amount: 3 });
  return actions;
}

export function applyAction(state, requested) {
  const actionId = typeof requested === "string" ? requested : requested?.id;
  const action = legalActions(state).find((item) => item.id === actionId);
  if (!action) throw new Error(`불법 행동: ${actionId ?? "undefined"}`);
  const next = cloneState(state);
  const player = next.currentPlayer;
  const chef = next.chefs[player];
  let text = "";
  if (action.type === "gather") {
    const before = chef.pantry[action.ingredient];
    chef.pantry[action.ingredient] = Math.min(6, before + action.amount);
    text = `${INGREDIENTS[action.ingredient].name} +${chef.pantry[action.ingredient] - before}`;
  } else if (action.type === "cool") {
    const amount = Math.min(action.amount, chef.heat);
    chef.heat -= amount;
    text = `냉각 팬 가동 · 열 -${amount}`;
  } else {
    const index = next.orders.findIndex((order) => order.orderId === action.orderId);
    const order = next.orders[index];
    for (const [ingredient, amount] of Object.entries(order.cost)) chef.pantry[ingredient] -= amount;
    const combo = chef.lastTag && chef.lastTag !== order.tag ? Math.min(3, chef.combo + 1) : 0;
    const gained = order.value + combo + (action.seasoned ? 2 : 0);
    chef.score += gained;
    chef.combo = combo;
    chef.lastTag = order.tag;
    chef.heat += Math.max(0, order.heat - (action.seasoned ? 1 : 0));
    if (action.seasoned) chef.season -= 1;
    chef.dishes.push({ ...order, gained, seasoned: action.seasoned });
    next.orders.splice(index, 1);
    if (next.orderDeck.length) next.orders.push(next.orderDeck.shift());
    text = `${order.name} 완성 · ${gained}점${combo ? ` · 콤보 +${combo}` : ""}${action.seasoned ? " · 셰프 스파크" : ""}`;
  }
  next.ply += 1;
  next.lastActions = [{ player, actionId: action.id, text }];
  if (next.ply >= next.maxPlies) settle(next);
  else next.currentPlayer = otherPlayer(player);
  return next;
}

export function finalScore(state, player) {
  const chef = state.chefs[player];
  const diversity = Math.min(...Object.values(chef.pantry)) * 2;
  return { cooked: chef.score, diversity, total: chef.score + diversity };
}

export function outcome(state) { return state.reason ? { winner: state.winner, reason: state.reason } : null; }

export function publicState(state, viewer = state.currentPlayer) {
  return {
    gameId: state.gameId, rulesVersion: state.rulesVersion, seed: state.seed, ply: state.ply, maxPlies: state.maxPlies,
    currentPlayer: state.currentPlayer, orders: cloneState(state.orders), nextOrder: state.orderDeck[0] ? { ...state.orderDeck[0] } : null,
    chefs: cloneState(state.chefs), scores: { P1: finalScore(state, "P1"), P2: finalScore(state, "P2") }, viewer,
    lastActions: cloneState(state.lastActions), legalActions: legalActions(state, viewer),
  };
}

export function actionText(action) {
  if (action.type === "gather") return `${INGREDIENTS[action.ingredient].name} 준비`;
  if (action.type === "cool") return "주방 냉각";
  return `${action.name} 조리${action.seasoned ? " + 셰프 스파크" : ""}`;
}
export function turnLabel(state) { return outcome(state) ? "서비스 종료" : `${state.currentPlayer} · ${state.ply + 1}/${state.maxPlies} 서비스`; }
export function progress(state) { return state.ply / state.maxPlies; }
export function stateKey(state) { return JSON.stringify([state.currentPlayer, state.orders.map((item) => item.orderId), state.chefs]); }

function settle(state) {
  const p1 = finalScore(state, "P1"); const p2 = finalScore(state, "P2");
  if (p1.total !== p2.total) state.winner = p1.total > p2.total ? "P1" : "P2";
  else if (state.chefs.P1.heat !== state.chefs.P2.heat) state.winner = state.chefs.P1.heat < state.chefs.P2.heat ? "P1" : "P2";
  else if (state.chefs.P1.dishes.length !== state.chefs.P2.dishes.length) state.winner = state.chefs.P1.dishes.length > state.chefs.P2.dishes.length ? "P1" : "P2";
  state.reason = state.winner ? `${state.winner}이 ${p1.total}:${p2.total}로 우주 정거장 최고의 셰프가 되었습니다.` : `${p1.total}:${p2.total}, 열과 완성 요리까지 같아 무승부입니다.`;
}

function recipe(id, name, cost, value, heat, tag) { return Object.freeze({ id, name, cost: Object.freeze(cost), value, heat, tag }); }
function newChef() { return { pantry: { algae: 1, spice: 1, crystal: 1 }, heat: 0, season: 2, score: 0, combo: 0, lastTag: null, dishes: [] }; }
function canAfford(chef, order) { return Object.entries(order.cost).every(([ingredient, amount]) => chef.pantry[ingredient] >= amount); }
function cookAction(order, seasoned) { return { id: `${seasoned ? "spark" : "cook"}:${order.orderId}`, type: "cook", orderId: order.orderId, name: order.name, value: order.value, heat: order.heat, tag: order.tag, seasoned }; }
function otherPlayer(player) { return player === "P1" ? "P2" : "P1"; }
function shuffle(items, seed) { const random = mulberry32(seed >>> 0); const copy = [...items]; for (let index = copy.length - 1; index > 0; index -= 1) { const target = Math.floor(random() * (index + 1)); [copy[index], copy[target]] = [copy[target], copy[index]]; } return copy; }
function mulberry32(seed) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let value = Math.imul(seed ^ seed >>> 15, 1 | seed); value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value; return ((value ^ value >>> 14) >>> 0) / 4294967296; }; }
