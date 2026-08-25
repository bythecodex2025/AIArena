import * as engine from "./engine.js";
import * as ai from "./ai.js";
import { mountArena } from "../arena-kit/app-shell.js";

const STARTER_AI_CODE = `function chooseAction(state, me) {
  const mine = state.histories[me];
  const unused = state.legalActions.filter(action =>
    !mine.some(entry => entry.code.join("") === action.code.join(""))
  );
  return unused[0];
}`;

const SPEC = `[Echo Vault AI 규격]\nchooseAction(state, me)를 작성하세요.\nstate.gameId="echo-vault". ownSecret은 내 암호이며 상대 암호는 공개되지 않습니다. histories.P1/P2에는 각 탐색 code와 exact(위치까지 정확), near(문양만 일치)가 들어 있습니다. remainingCandidates는 각 플레이어가 상대 암호 후보를 몇 개로 좁혔는지 표시합니다. legalActions의 probe 행동 하나를 동기적으로 반환하세요. 암호는 △ ○ □ ◇ 중 중복 없는 3개입니다. 각자 최대 6회 탐색하며 exact 3을 만들면 승리합니다. 라운드 선공이 먼저 맞히면 후공도 마지막 응답을 받습니다. 제한은 50KB, 행동당 500ms입니다.\n\n${STARTER_AI_CODE}`;

mountArena({
  gameId: "echo-vault",
  title: "Echo Vault",
  engine,
  ai,
  starterCode: STARTER_AI_CODE,
  spec: SPEC,
  codeFileName: "my-vault-breaker.js",
  storageKey: "echo-vault-ai",
  defaultOpponent: "v4",
  watchLevels: ["v3", "v5"],
  startMessage: "상대 금고의 세 문양을 추론하세요.",
  turnMessage: (state) => `후보를 좁힐 탐색 코드를 고르세요. 현재 ${engine.candidateCodes(state.histories.P1).length}개 후보가 남았습니다.`,
  emptyLog: "탐색을 시작하면 피드백이 기록됩니다.",
  actionMarkup: (action) => `<b class="probe-code">${action.code.join(" ")}</b><span>탐색 신호 전송</span>`,
  renderGame: (state, context) => renderGame(state, context),
});

function renderGame(state, { mode, opponent, reveal }) {
  const p1Candidates = engine.candidateCodes(state.histories.P1).length;
  const p2Candidates = engine.candidateCodes(state.histories.P2).length;
  const showP1 = mode === "human" || reveal;
  return `<div class="vault-stage game-view">
    <section class="agent-panel p1">
      <span class="agent-tag">OPERATIVE P1</span><h3>${mode === "watch" ? ai.AI_LEVELS.v3.name : "YOU"}</h3>
      <div class="secret-code">${showP1 ? state.secrets.P1.join(" ") : "● ● ●"}</div>
      <p>상대 암호 후보 <b>${p1Candidates}</b>개</p>${historyHtml(state.histories.P1)}
    </section>
    <div class="vault-core"><div class="scanner-ring"><span>${state.winner ? "OPEN" : "LOCKED"}</span><b>${state.ply}</b><small>/ ${state.maxPlies} SIGNALS</small></div><p>정확 = 문양과 위치 일치<br>근접 = 문양만 일치</p></div>
    <section class="agent-panel p2">
      <span class="agent-tag">OPERATIVE P2</span><h3>${mode === "watch" ? ai.AI_LEVELS.v5.name : opponent}</h3>
      <div class="secret-code">${reveal ? state.secrets.P2.join(" ") : "● ● ●"}</div>
      <p>상대 암호 후보 <b>${p2Candidates}</b>개</p>${historyHtml(state.histories.P2)}
    </section>
  </div>`;
}

function historyHtml(history) {
  return `<ol class="signal-history">${history.length ? history.map((entry, index) => `<li><span>${index + 1}</span><b>${entry.code.join(" ")}</b><em>E${entry.exact} N${entry.near}</em></li>`).join("") : "<li class=empty>아직 신호 없음</li>"}</ol>`;
}
