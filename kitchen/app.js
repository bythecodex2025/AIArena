import * as engine from "./engine.js";
import * as ai from "./ai.js";
import { mountArena } from "../arena-kit/app-shell.js";

const STARTER_AI_CODE = `function chooseAction(state, me) {
  const cook = state.legalActions
    .filter(action => action.type === "cook")
    .sort((a, b) => b.value - a.value);
  if (cook.length) return cook[0];
  return state.legalActions.find(action => action.type === "gather");
}`;
const SPEC = `[Orbit Kitchen AI 규격]\nchooseAction(state, me)를 작성하세요. orders는 현재 공유 주문 3개, nextOrder는 다음 주문 미리보기입니다. chefs.P1/P2에는 pantry(algae, spice, crystal), heat(0~6), season, score, combo, lastTag, dishes가 있습니다. gather는 재료 +2, cook은 주문 선점, spark 조리는 시즌 토큰을 써서 +2점과 열 -1, cool은 열 -3입니다. 서로 다른 맛 태그를 연속 조리하면 최대 +3 콤보가 붙습니다. 24행동 뒤 요리 점수 + 재료 3종 균형 보너스로 승부합니다. legalActions 중 하나를 동기 반환하며 50KB/500ms 제한입니다.\n\n${STARTER_AI_CODE}`;

mountArena({
  gameId: "orbit-kitchen", title: "Orbit Kitchen", engine, ai, starterCode: STARTER_AI_CODE, spec: SPEC,
  codeFileName: "my-orbit-chef.js", storageKey: "orbit-kitchen-ai", defaultOpponent: "v3", watchLevels: ["v4", "v5"],
  startMessage: "공유 주문을 먼저 완성하고 맛 콤보를 이어가세요.",
  turnMessage: () => "재료를 준비하거나 주문을 완성하세요. 열이 높으면 냉각이 필요합니다.",
  emptyLog: "주방을 열면 재료 준비와 완성 요리가 기록됩니다.",
  actionMarkup: (action) => actionMarkup(action), renderGame: (state, context) => renderGame(state, context),
});

function renderGame(state, { mode, opponent }) {
  return `<div class="kitchen-stage game-view">
    <section class="chef-card p1">${chefHtml(state, "P1", mode === "watch" ? ai.AI_LEVELS.v4.name : "YOU")}</section>
    <section class="pass-window"><div class="ticket-title"><span>ORDER WINDOW</span><b>오늘의 우주식</b></div><div class="orders">${state.orders.map(orderHtml).join("")}</div><div class="next-ticket">NEXT · ${state.orderDeck[0]?.name ?? "주문 마감"}</div></section>
    <section class="chef-card p2">${chefHtml(state, "P2", mode === "watch" ? ai.AI_LEVELS.v5.name : opponent)}</section>
  </div>`;
}

function chefHtml(state, player, name) {
  const chef = state.chefs[player]; const score = engine.finalScore(state, player);
  return `<span class="station">STATION ${player}</span><h3>${name}</h3><strong class="chef-score">${score.total}<small> PT</small></strong><div class="pantry">${Object.entries(engine.INGREDIENTS).map(([key, item]) => `<div class="ingredient ${item.color}"><span>${item.icon}</span><b>${chef.pantry[key]}</b><small>${item.name}</small></div>`).join("")}</div><div class="heat"><span>HEAT</span><i style="width:${chef.heat / 6 * 100}%"></i><b>${chef.heat}/6</b></div><p>셰프 스파크 <b>${chef.season}</b> · 콤보 <b>${chef.combo}</b></p><div class="dish-line">${chef.dishes.length ? chef.dishes.map((dish) => `<span title="${dish.name}">${dish.name.slice(0,2)}<b>+${dish.gained}</b></span>`).join("") : "아직 완성 요리 없음"}</div>`;
}

function orderHtml(order) {
  return `<article class="order-ticket"><span>${order.tag.toUpperCase()}</span><h4>${order.name}</h4><div>${Object.entries(order.cost).map(([key, amount]) => `${engine.INGREDIENTS[key].icon}${amount}`).join(" · ")}</div><b>${order.value}점</b><small>열 +${order.heat}</small></article>`;
}

function actionMarkup(action) {
  if (action.type === "gather") { const item = engine.INGREDIENTS[action.ingredient]; return `<b>${item.icon} ${item.name}</b><span>팬트리에 +2</span>`; }
  if (action.type === "cool") return `<b>❄ 냉각 팬</b><span>열 -3</span>`;
  return `<b>${action.name}</b><span>${action.value}점 · 열 +${Math.max(0, action.heat - (action.seasoned ? 1 : 0))}${action.seasoned ? " · 스파크 +2점" : ""}</span>`;
}
