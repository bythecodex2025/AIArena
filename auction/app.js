import {
  PATRONS,
  RULES_VERSION,
  SUIT_INFO,
  actionText,
  applyAction,
  cloneState,
  initialState,
  legalActions,
  outcome,
  publicState,
  scoreBreakdown,
} from "./engine.js";
import { AI_LEVELS, chooseAction as chooseBuiltIn } from "./ai.js";
import {
  CUSTOM_AI_LIMITS,
  CUSTOM_AI_SPEC,
  STARTER_AI_CODE,
  runCustomAI,
  terminateCustomAIWorkers,
  validateCustomCode,
  validateCustomFileMetadata,
} from "./custom-ai-runner.js";
import { battleLogFilename, fairSideSchedule, formatBattleLog } from "./battle-log.js";

const $ = (id) => document.getElementById(id);
let state = initialState();
let mode = "idle";
let thinking = false;
let session = 0;
let moveEntries = [];
let battleStopRequested = false;
let battleRecords = [];
let replayFrames = [];
let replayIndex = 0;

function setup() {
  for (const [level, info] of Object.entries(AI_LEVELS)) {
    $("humanOpponent").add(new Option(info.name, level));
    $("battleOpponent").add(new Option(info.name, level));
  }
  $("humanOpponent").value = "v3";
  $("editor").value = loadCode() || STARTER_AI_CODE;
  $("editor").addEventListener("input", () => storeCode($("editor").value));
  $("newGame").onclick = startHumanGame;
  $("watchAI").onclick = watchGame;
  $("stopGame").onclick = stopGame;
  $("resetCode").onclick = resetCode;
  $("copySpec").onclick = copySpec;
  $("testCode").onclick = testCode;
  $("uploadCode").onclick = () => $("fileInput").click();
  $("fileInput").onchange = loadCodeFile;
  $("runBattle").onclick = startBattle;
  $("stopBattle").onclick = stopBattle;
  $("closeResult").onclick = () => $("resultModal").hidden = true;
  $("closeReplay").onclick = closeReplay;
  $("replayPrev").onclick = () => showReplayFrame(replayIndex - 1);
  $("replayNext").onclick = () => showReplayFrame(replayIndex + 1);
  $("resultModal").onclick = (event) => { if (event.target === $("resultModal")) $("resultModal").hidden = true; };
  $("replayModal").onclick = (event) => { if (event.target === $("replayModal")) closeReplay(); };
  render();
}

function render() {
  const view = publicState(state);
  const scores = scoreBreakdown(state);
  $("turnChip").textContent = state.phase === "patron"
    ? `${state.currentPlayer} · 후원자 선택`
    : state.winner ? "경매 종료" : `${state.currentPlayer} · ${state.lotIndex + 1}/${state.maxLots} LOT`;
  $("lotProgress").style.width = `${Math.min(100, state.lotIndex / state.maxLots * 100)}%`;
  for (const player of ["P1", "P2"]) {
    const key = player.toLowerCase();
    $(`${key}Credits`).textContent = state.credits[player];
    $(`${key}Favor`).textContent = state.favor[player];
    $(`${key}Score`).textContent = state.patrons[player] ? scores[player].total : 0;
    $(`${key}Patron`).textContent = state.patrons[player] ? PATRONS[state.patrons[player]].name : "후원자 미정";
    $(`${key}Collection`).innerHTML = collectionHtml(state.collections[player]);
  }
  $("p1Label").textContent = mode === "watch" ? AI_LEVELS.v3.name : "YOU · P1";
  $("p2Label").textContent = mode === "watch" ? AI_LEVELS.v4.name : `${AI_LEVELS[$("humanOpponent").value]?.name ?? "AI"} · P2`;
  renderLot(view);
  renderActions(view);
  renderLog();
}

function renderLot(view) {
  $("currentLot").innerHTML = view.currentLot
    ? artifactHtml(view.currentLot, true)
    : `<div class="empty-lot"><span>✧</span><b>${state.phase === "patron" ? "후원자를 먼저 선택하세요" : "경매가 끝났습니다"}</b></div>`;
  $("nextLot").innerHTML = view.nextLot ? artifactHtml(view.nextLot, false) : `<span class="no-preview">마지막 LOT</span>`;
  $("highBid").textContent = view.highBid;
  $("bidLeader").textContent = view.leader ? `${view.leader} 선두 · 실제 지불 ${view.leaderCost}` : "아직 입찰 없음";
  $("auctionHint").textContent = view.currentLot
    ? `${SUIT_INFO[view.currentLot.suit].name} · 기본 ${view.currentLot.value}점${abilityText(view.currentLot.ability)}`
    : "후원자는 최종 점수 공식을 바꿉니다.";
}

function renderActions(view) {
  const canAct = mode === "human" && !thinking && state.currentPlayer === "P1" && !state.winner;
  const actions = canAct ? view.legalActions : [];
  $("actionGrid").innerHTML = actions.length ? actions.map((action) => {
    if (action.type === "patron") {
      const patron = PATRONS[action.patronId];
      return `<button class="patron-action" data-action="${action.id}"><b>${escapeHtml(patron.name)}</b><span>${escapeHtml(patron.description)}</span></button>`;
    }
    if (action.type === "bid") {
      return `<button class="bid-action ${action.useFavor ? "favor" : ""}" data-action="${action.id}"><b>${action.offer}</b><span>${action.useFavor ? `영향력 1 · 지불 ${action.payment}` : `크레딧 ${action.payment}`}</span></button>`;
    }
    return `<button class="pass-action" data-action="pass"><b>PASS</b><span>${state.leader ? "상대에게 낙찰" : "입찰하지 않기"}</span></button>`;
  }).join("") : `<p class="action-placeholder">${thinking ? "AI가 가격과 컬렉션을 계산 중입니다…" : mode === "human" ? "상대의 행동을 기다리는 중입니다." : "사람 대 AI 또는 관전을 시작하세요."}</p>`;
  for (const button of $("actionGrid").querySelectorAll("[data-action]")) button.onclick = () => humanChoose(button.dataset.action);
}

function startHumanGame() {
  stopGame();
  mode = "human";
  state = initialState({ seed: randomSeed() });
  moveEntries = [];
  $("gameStatus").innerHTML = "먼저 내 점수 전략을 정할 <b>후원자</b>를 선택하세요.";
  render();
}

function stopGame() {
  session += 1;
  thinking = false;
  if (mode === "human" || mode === "watch") {
    mode = "idle";
    $("gameStatus").textContent = "게임을 중지했습니다.";
  }
  render();
}

async function humanChoose(actionId) {
  if (mode !== "human" || thinking || state.currentPlayer !== "P1") return;
  const action = legalActions(state).find((item) => item.id === actionId);
  if (!action) return;
  applyAndRecord(action, "YOU");
  render();
  if (finishVisibleGame()) return;

  thinking = true;
  render();
  const currentSession = session;
  while (mode === "human" && currentSession === session && !outcome(state) && state.currentPlayer === "P2") {
    $("gameStatus").textContent = `${AI_LEVELS[$("humanOpponent").value].name}가 입찰을 계산 중입니다…`;
    await delay(160);
    if (mode !== "human" || currentSession !== session) return;
    const choice = chooseBuiltIn(state, $("humanOpponent").value, { timeMs: 220, maxDepth: 6 });
    updateTelemetry(choice.stats);
    applyAndRecord(choice.action, AI_LEVELS[$("humanOpponent").value].name);
    render();
  }
  thinking = false;
  render();
  if (!finishVisibleGame()) $("gameStatus").innerHTML = state.phase === "patron" ? "내 <b>후원자</b>를 선택하세요." : "내 차례입니다. 가격을 올리거나 <b>패스</b>하세요.";
}

async function watchGame() {
  stopGame();
  mode = "watch";
  state = initialState({ seed: randomSeed() });
  moveEntries = [];
  const currentSession = session;
  render();
  while (mode === "watch" && currentSession === session && !outcome(state)) {
    const level = state.currentPlayer === "P1" ? "v3" : "v4";
    $("gameStatus").textContent = `${AI_LEVELS[level].name} 생각 중…`;
    await delay(120);
    if (mode !== "watch" || currentSession !== session) return;
    const choice = chooseBuiltIn(state, level, { timeMs: 180, maxDepth: 5 });
    updateTelemetry(choice.stats);
    applyAndRecord(choice.action, AI_LEVELS[level].name);
    render();
  }
  finishVisibleGame();
}

function applyAndRecord(action, actor) {
  const player = state.currentPlayer;
  state = applyAction(state, action);
  const text = state.lastActions[0]?.text ?? actionText(action);
  moveEntries.push(`${state.ply}. ${player} ${actor} · ${text.replace(`${player} · `, "")}`);
}

function finishVisibleGame() {
  const end = outcome(state);
  if (!end) return false;
  mode = "idle";
  thinking = false;
  const scores = scoreBreakdown(state);
  $("resultIcon").textContent = end.winner ? "✦" : "◇";
  $("resultTitle").textContent = end.winner ? `${end.winner} 승리` : "무승부";
  $("resultReason").textContent = `${end.reason} · 최종 ${scores.P1.total} : ${scores.P2.total}`;
  $("resultModal").hidden = false;
  $("gameStatus").textContent = end.reason;
  render();
  return true;
}

async function testCode() {
  setCodeMessage("초기 상태에서 사용자 AI를 검증 중입니다…");
  try {
    validateCustomCode($("editor").value);
    const testState = initialState({ seed: 101 });
    const choice = await runCustomAI($("editor").value, testState);
    setCodeMessage(`통과 · ${actionText(choice.action)} · ${choice.stats.elapsedMs}ms`, "ok");
  } catch (error) {
    setCodeMessage(error.message, "error");
  }
}

async function startBattle() {
  if (battleStopRequested === false && $("runBattle").disabled) return;
  try { validateCustomCode($("editor").value); } catch (error) { return setCodeMessage(error.message, "error"); }
  battleStopRequested = false;
  $("runBattle").disabled = true;
  $("stopBattle").disabled = false;
  battleRecords = [];
  const selected = $("battleOpponent").value;
  const opponents = selected === "all" ? Object.keys(AI_LEVELS) : [selected];
  const count = Number($("battleCount").value);
  const jobs = [];
  let sequence = 1;
  for (const opponent of opponents) {
    for (const side of fairSideSchedule(count)) {
      jobs.push({ opponent, customSide: side, sequence, seed: 7400 + Math.floor((sequence - 1) / 2) });
      sequence += 1;
    }
  }
  updateBattleProgress(0, jobs.length);
  for (let index = 0; index < jobs.length && !battleStopRequested; index += 1) {
    const record = await playCustomMatch(jobs[index]);
    battleRecords.push(record);
    renderBattleResults();
    updateBattleProgress(index + 1, jobs.length);
    await delay(0);
  }
  $("runBattle").disabled = false;
  $("stopBattle").disabled = true;
  setCodeMessage(battleStopRequested ? "대전을 중지했습니다." : `${battleRecords.length}경기 완료`, battleStopRequested ? "" : "ok");
}

async function playCustomMatch(job) {
  let match = initialState({ seed: job.seed });
  const frames = [{ state: cloneState(match), label: "경기 시작" }];
  const actions = [];
  let error = null;
  while (!outcome(match)) {
    const side = match.currentPlayer;
    const before = cloneState(match);
    let choice;
    try {
      choice = side === job.customSide
        ? await runCustomAI($("editor").value, match)
        : chooseBuiltIn(match, job.opponent, { timeMs: 120, maxDepth: 5 });
    } catch (caught) {
      error = caught.message;
      match = cloneState(match);
      match.winner = side === "P1" ? "P2" : "P1";
      match.reason = `사용자 AI 오류: ${error}`;
      break;
    }
    match = applyAction(match, choice.action);
    const scores = scoreBreakdown(match);
    const text = match.lastActions[0]?.text ?? actionText(choice.action);
    actions.push({
      ply: match.ply, side, actor: side === job.customSide ? "내 AI" : AI_LEVELS[job.opponent].name,
      text, elapsedMs: choice.stats.elapsedMs, credits: match.credits[side], favor: match.favor[side], score: scores[side].total,
    });
    frames.push({ state: cloneState(match), label: `${side} · ${text}` });
    if (before.ply === match.ply) throw new Error("경기 상태가 진행되지 않았습니다.");
  }
  const end = outcome(match);
  const result = !end.winner ? "draw" : end.winner === job.customSide ? "win" : "loss";
  return {
    frames,
    log: {
      rulesVersion: RULES_VERSION, sequence: job.sequence, seed: job.seed, opponent: job.opponent,
      opponentName: AI_LEVELS[job.opponent].name, customSide: job.customSide, codeFileName: $("editorFileName").textContent,
      result: error ? "error" : result, reason: end.reason, plies: match.ply, timeoutMs: CUSTOM_AI_LIMITS.actionTimeMs,
      maxPlies: match.maxPlies, actions, error,
    },
  };
}

function stopBattle() {
  battleStopRequested = true;
  terminateCustomAIWorkers();
  $("stopBattle").disabled = true;
}

function renderBattleResults() {
  const totals = { win: 0, draw: 0, loss: 0, error: 0 };
  for (const record of battleRecords) totals[record.log.result] += 1;
  $("wins").textContent = totals.win;
  $("draws").textContent = totals.draw;
  $("losses").textContent = totals.loss;
  $("errors").textContent = totals.error;
  const grouped = new Map();
  for (const record of battleRecords) {
    const row = grouped.get(record.log.opponent) ?? { win: 0, draw: 0, loss: 0, error: 0 };
    row[record.log.result] += 1;
    grouped.set(record.log.opponent, row);
  }
  $("battleRows").innerHTML = grouped.size ? [...grouped].map(([opponent, row]) => `<tr><td>${escapeHtml(AI_LEVELS[opponent].name)}</td><td>${row.win}</td><td>${row.draw}</td><td>${row.loss}</td><td>${row.error}</td></tr>`).join("") : `<tr><td colspan="5">대전을 시작하면 결과가 표시됩니다.</td></tr>`;
  $("battleLogs").innerHTML = battleRecords.length ? battleRecords.map((record, index) => `<div class="log-row"><span>#${record.log.sequence} · ${record.log.customSide} · ${record.log.result.toUpperCase()} · seed ${record.log.seed}</span><button data-replay="${index}">리플레이</button><button data-log="${index}">로그</button></div>`).join("") : `<p>완료된 경기의 로그와 리플레이가 여기에 표시됩니다.</p>`;
  for (const button of $("battleLogs").querySelectorAll("[data-replay]")) button.onclick = () => openReplay(Number(button.dataset.replay));
  for (const button of $("battleLogs").querySelectorAll("[data-log]")) button.onclick = () => downloadLog(Number(button.dataset.log));
}

function openReplay(index) {
  replayFrames = battleRecords[index].frames;
  replayIndex = 0;
  $("replayModal").hidden = false;
  showReplayFrame(0);
}

function showReplayFrame(index) {
  if (!replayFrames.length) return;
  replayIndex = Math.max(0, Math.min(index, replayFrames.length - 1));
  const frame = replayFrames[replayIndex];
  const view = publicState(frame.state);
  $("replayCounter").textContent = `${replayIndex + 1} / ${replayFrames.length}`;
  $("replayLabel").textContent = frame.label;
  $("replayState").innerHTML = `<div>${view.currentLot ? artifactHtml(view.currentLot, false) : "<b>경매 종료</b>"}</div><p>현재가 <b>${view.highBid}</b> · 선두 <b>${view.leader ?? "없음"}</b></p><p>P1 ${view.scores.P1.total}점 / ${view.credits.P1}C · P2 ${view.scores.P2.total}점 / ${view.credits.P2}C</p>`;
  $("replayPrev").disabled = replayIndex === 0;
  $("replayNext").disabled = replayIndex === replayFrames.length - 1;
}

function closeReplay() {
  $("replayModal").hidden = true;
  replayFrames = [];
}

function downloadLog(index) {
  const log = battleRecords[index].log;
  downloadText(battleLogFilename(log), formatBattleLog(log));
}

function renderLog() {
  $("moveLog").innerHTML = moveEntries.length ? moveEntries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("") : `<li>경기를 시작하면 입찰과 낙찰이 기록됩니다.</li>`;
  $("moveLog").scrollTop = $("moveLog").scrollHeight;
}

function artifactHtml(item, large) {
  const suit = SUIT_INFO[item.suit];
  return `<article class="artifact ${item.suit.toLowerCase()} ${large ? "large" : ""}"><span class="artifact-suit">${suit.symbol} ${escapeHtml(suit.name)}</span><b>${escapeHtml(item.name)}</b><strong>${item.value}<small> PT</small></strong><em>${abilityLabel(item.ability)}</em></article>`;
}

function collectionHtml(collection) {
  return collection.length ? collection.map((item) => `<span class="mini-artifact ${item.suit.toLowerCase()}" title="${escapeHtml(item.name)} · ${item.value}점">${SUIT_INFO[item.suit].symbol}<b>${item.value}</b></span>`).join("") : `<span class="empty-collection">아직 낙찰 없음</span>`;
}

function abilityLabel(ability) {
  return ability === "refund" ? "낙찰 시 +2C" : ability === "favor" ? "낙찰 시 영향력 +1" : "순수 명작";
}

function abilityText(ability) {
  return ability ? ` · ${abilityLabel(ability)}` : "";
}

function updateTelemetry(stats) {
  $("searchLevel").textContent = stats.level?.toUpperCase?.() ?? stats.source;
  $("searchNodes").textContent = `${Number(stats.nodes).toLocaleString()} nodes`;
  $("searchDepth").textContent = `depth ${stats.depth}`;
  $("searchTime").textContent = `${stats.elapsedMs} ms`;
}

function updateBattleProgress(done, total) {
  $("battleProgressText").textContent = `${done} / ${total}`;
  $("battleProgressBar").style.width = `${total ? done / total * 100 : 0}%`;
}

function resetCode() {
  $("editor").value = STARTER_AI_CODE;
  $("editorFileName").textContent = "my-auction-ai.js";
  storeCode(STARTER_AI_CODE);
  setCodeMessage("예제 AI를 복원했습니다.", "ok");
}

async function copySpec() {
  try { await navigator.clipboard.writeText(CUSTOM_AI_SPEC); setCodeMessage("전체 AI 규격을 복사했습니다.", "ok"); }
  catch { setCodeMessage("클립보드 복사에 실패했습니다.", "error"); }
}

async function loadCodeFile(event) {
  const file = event.target.files?.[0];
  try {
    validateCustomFileMetadata(file);
    const code = await file.text();
    validateCustomCode(code);
    $("editor").value = code;
    $("editorFileName").textContent = file.name;
    storeCode(code);
    setCodeMessage(`${file.name}을 불러왔습니다.`, "ok");
  } catch (error) { setCodeMessage(error.message, "error"); }
  event.target.value = "";
}

function setCodeMessage(text, type = "") {
  $("codeMessage").textContent = text;
  $("codeMessage").className = `code-message ${type}`;
}

function loadCode() { try { return localStorage.getItem("starlight-auction-ai"); } catch { return null; } }
function storeCode(code) { try { localStorage.setItem("starlight-auction-ai", code); } catch { /* unavailable */ } }
function randomSeed() { return Math.floor(Date.now() % 1_000_000_000); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function downloadText(filename, contents) { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" })); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }

setup();
