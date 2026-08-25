import {
  RULES_VERSION,
  MAX_PLIES,
  RELAY_POSITIONS,
  actionText,
  applyAction,
  cloneState,
  initialState,
  legalActions,
  outcome,
  publicState,
  relayControl,
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
let lastPosition = null;
let moveEntries = [];
let battleRunning = false;
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
  $("levelCards").innerHTML = Object.entries(AI_LEVELS).map(([level, info]) => `
    <article class="level-card"><span>${level.toUpperCase()} · DEPTH ${info.depth}</span><h3>${escapeHtml(info.name)}</h3><p>${escapeHtml(info.description)}</p></article>
  `).join("");

  $("editor").value = loadStoredCode() || STARTER_AI_CODE;
  $("editor").addEventListener("input", () => storeCode($("editor").value));
  $("newGame").onclick = startHumanGame;
  $("waitAction").onclick = () => {
    const passive = legalActions(state).find((action) => action.type === "wait" || action.type === "settle");
    if (passive) humanChoose(passive.id);
  };
  $("watchAI").onclick = watchAIGame;
  $("stopGame").onclick = stopCurrentGame;
  $("uploadCode").onclick = () => $("fileInput").click();
  $("fileInput").onchange = loadCodeFile;
  $("resetCode").onclick = resetCode;
  $("copySpec").onclick = copySpec;
  $("testCode").onclick = testCode;
  $("runBattle").onclick = startBattle;
  $("stopBattle").onclick = stopBattle;
  $("closeResult").onclick = () => $("resultModal").hidden = true;
  $("resultModal").onclick = (event) => { if (event.target === $("resultModal")) $("resultModal").hidden = true; };
  $("replayPrev").onclick = () => showReplayFrame(replayIndex - 1);
  $("replayNext").onclick = () => showReplayFrame(replayIndex + 1);
  $("closeReplay").onclick = closeReplay;
  render();
}

function render() {
  const view = publicState(state);
  $("turnChip").textContent = `${state.currentPlayer} · ${state.ply}/${state.maxPlies}`;
  $("p1Energy").textContent = state.energy.P1;
  $("p2Energy").textContent = state.energy.P2;
  $("p1Streak").textContent = state.signalScores.P1;
  $("p2Streak").textContent = state.signalScores.P2;
  $("p2Label").textContent = mode === "watch" ? `${AI_LEVELS.v4.name} · 적 기지 P2` : `${AI_LEVELS[$("humanOpponent").value]?.name ?? "AI"} · 적 기지 P2`;
  $("p1Label").textContent = mode === "watch" ? `${AI_LEVELS.v3.name} · 내 기지 P1` : "내 기지 · YOU P1";
  renderBoard(view);
  renderRelays(view.relays);
  renderMoveLog();
  const passiveAction = legalActions(state).find((action) => action.type === "wait" || action.type === "settle");
  $("waitAction").textContent = passiveAction?.type === "settle" ? "교착 정산하고 종료" : "대기하며 에너지 충전";
  $("waitAction").disabled = !(mode === "human" && !thinking && state.currentPlayer === "P1" && passiveAction);
}

function renderBoard(view) {
  const board = $("board");
  const humanActions = mode === "human" && !thinking && state.currentPlayer === "P1" ? legalActions(state) : [];
  const actionAt = new Map();
  for (const action of humanActions) {
    const position = actionPosition(action, state);
    if (position !== null) actionAt.set(position, action);
  }
  board.innerHTML = "";
  renderConnections(board, view, humanActions);
  for (let position = 0; position < 25; position += 1) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.disabled = !actionAt.has(position);
    if (RELAY_POSITIONS.includes(position)) cell.classList.add("relay");
    if (position === lastPosition) cell.classList.add("last");
    const action = actionAt.get(position);
    if (action) {
      cell.classList.add("legal");
      cell.onclick = () => humanChoose(action.id);
    }
    const coord = document.createElement("span");
    coord.className = "coord";
    coord.textContent = `${String.fromCharCode(65 + position % 5)}${Math.floor(position / 5) + 1}`;
    cell.appendChild(coord);

    const core = view.cores.find((item) => item.position === position);
    const node = view.nodes.find((item) => item.position === position);
    if (core) cell.appendChild(entityElement("core", core.owner, false, true, "BASE"));
    if (node) cell.appendChild(entityElement("node", node.owner, node.fortified, node.powered, node.fortified ? "F" : "●"));
    const relay = view.relays.find((item) => item.position === position);
    if (relay) {
      const relayName = document.createElement("span");
      relayName.className = "relay-name";
      relayName.textContent = `중계기 ${String.fromCharCode(65 + RELAY_POSITIONS.indexOf(position))}`;
      cell.appendChild(relayName);
      const relayScore = document.createElement("span");
      relayScore.className = "relay-score";
      relayScore.textContent = `${relay.influence.P2} : ${relay.influence.P1}`;
      relayScore.title = `적 영향력 ${relay.influence.P2}, 내 영향력 ${relay.influence.P1}`;
      cell.appendChild(relayScore);
    }
    if (relay?.owner) {
      const mark = document.createElement("i");
      mark.className = `relay-owner ${relay.owner.toLowerCase()}`;
      cell.appendChild(mark);
    }
    if (action) {
      const tag = document.createElement("span");
      tag.className = "action-tag";
      tag.textContent = actionTag(action);
      cell.appendChild(tag);
    }
    board.appendChild(cell);
  }
}

function renderConnections(board, view, previewActions) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("network-links");
  svg.setAttribute("viewBox", "0 0 500 500");
  svg.setAttribute("aria-hidden", "true");
  for (const owner of ["P1", "P2"]) {
    const positions = [
      ...view.cores.filter((item) => item.owner === owner).map((item) => item.position),
      ...view.nodes.filter((item) => item.owner === owner && item.powered).map((item) => item.position),
    ];
    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        if (!areAdjacent(positions[left], positions[right])) continue;
        svg.appendChild(connectionLine(positions[left], positions[right], owner.toLowerCase()));
      }
    }
  }
  const currentSources = [
    ...view.cores.filter((item) => item.owner === view.currentPlayer).map((item) => item.position),
    ...view.nodes.filter((item) => item.owner === view.currentPlayer && item.powered).map((item) => item.position),
  ];
  for (const action of previewActions.filter((item) => item.type === "extend")) {
    const source = currentSources.find((position) => areAdjacent(position, action.to));
    if (source !== undefined) svg.appendChild(connectionLine(source, action.to, "preview"));
  }
  board.appendChild(svg);
}

function connectionLine(from, to, className) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", (from % 5) * 100 + 50);
  line.setAttribute("y1", Math.floor(from / 5) * 100 + 50);
  line.setAttribute("x2", (to % 5) * 100 + 50);
  line.setAttribute("y2", Math.floor(to / 5) * 100 + 50);
  line.setAttribute("class", `network-line ${className}`);
  return line;
}

function areAdjacent(left, right) {
  return Math.abs(Math.floor(left / 5) - Math.floor(right / 5)) + Math.abs(left % 5 - right % 5) === 1;
}

function entityElement(kind, owner, fortified, powered, text) {
  const entity = document.createElement("span");
  entity.className = `entity ${kind} ${owner.toLowerCase()} ${powered ? "" : "offline"} ${fortified ? "fortified" : ""}`;
  const label = document.createElement("span");
  label.textContent = text;
  entity.appendChild(label);
  return entity;
}

function renderRelays(relays) {
  $("relayDots").innerHTML = relays.map((relay, index) => `<i class="${relay.owner?.toLowerCase() ?? ""}" title="중계기 ${String.fromCharCode(65 + index)} · 적 ${relay.influence.P2} : 내 ${relay.influence.P1}"></i>`).join("");
}

function renderMoveLog() {
  $("moveLog").innerHTML = moveEntries.length
    ? moveEntries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")
    : "<li>경기를 시작하면 행동이 기록됩니다.</li>";
  $("moveLog").scrollTop = $("moveLog").scrollHeight;
}

function startHumanGame() {
  stopCurrentGame();
  mode = "human";
  state = initialState();
  lastPosition = null;
  moveEntries = [];
  $("gameStatus").innerHTML = "내 차례입니다. <b>설치</b>할 초록 칸이나 행동 가능한 노드를 선택하세요.";
  render();
}

function stopCurrentGame() {
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
  $("gameStatus").textContent = `${AI_LEVELS[$("humanOpponent").value].name}가 연결망을 분석 중입니다…`;
  render();
  const gameSession = session;
  await delay(120);
  if (gameSession !== session || mode !== "human") return;
  const choice = chooseBuiltIn(state, $("humanOpponent").value, { timeMs: 220, maxDepth: 6 });
  updateTelemetry(choice.stats);
  applyAndRecord(choice.action, AI_LEVELS[$("humanOpponent").value].name);
  thinking = false;
  render();
  if (!finishVisibleGame()) {
    $("gameStatus").innerHTML = choice.action.type === "swap"
      ? "<b>진영 교환!</b> AI가 내 첫 수를 넘겨받아 보드가 180도 바뀌었습니다. 이제 아래쪽 내 기지에서 다시 두세요."
      : "내 차례입니다. <b>설치</b>할 초록 칸이나 행동 가능한 노드를 선택하세요.";
  }
}

async function watchAIGame() {
  stopCurrentGame();
  mode = "watch";
  state = initialState();
  moveEntries = [];
  lastPosition = null;
  const gameSession = session;
  render();
  while (mode === "watch" && gameSession === session && !outcome(state)) {
    const level = state.currentPlayer === "P1" ? "v3" : "v4";
    $("gameStatus").textContent = `${AI_LEVELS[level].name} 생각 중…`;
    await delay(180);
    if (mode !== "watch" || gameSession !== session) return;
    const choice = chooseBuiltIn(state, level, { timeMs: 180, maxDepth: 5 });
    updateTelemetry(choice.stats);
    applyAndRecord(choice.action, AI_LEVELS[level].name);
    render();
  }
  finishVisibleGame();
}

function applyAndRecord(action, actor) {
  const side = state.currentPlayer;
  const text = friendlyActionText(state, action);
  lastPosition = actionPosition(action, state);
  state = applyAction(state, action);
  moveEntries.push(`${state.ply}. ${side} ${actor} · ${text}`);
}

function finishVisibleGame() {
  const end = outcome(state);
  if (!end) return false;
  mode = "idle";
  thinking = false;
  const draw = !end.winner;
  $("resultIcon").textContent = draw ? "◇" : "◆";
  $("resultTitle").textContent = draw ? "무승부" : `${end.winner} 승리`;
  $("resultReason").textContent = `${end.reason} · ${state.ply}반수`;
  $("resultModal").hidden = false;
  $("gameStatus").textContent = end.reason;
  render();
  return true;
}

async function testCode() {
  setCodeMessage("초기 상태에서 사용자 AI를 검증 중입니다…");
  try {
    const result = await runCustomAI(normalizeCode($("editor").value), initialState());
    setCodeMessage(`검증 성공 · ${friendlyActionText(initialState(), result.action)} · ${result.stats.elapsedMs}ms`, "ok");
  } catch (error) {
    setCodeMessage(error.message, "error");
  }
}

async function startBattle() {
  if (battleRunning) return;
  stopCurrentGame();
  let code;
  try {
    code = normalizeCode($("editor").value);
    validateCustomCode(code);
  } catch (error) {
    setCodeMessage(error.message, "error");
    return;
  }

  const selected = $("battleOpponent").value;
  const opponents = selected === "all" ? Object.keys(AI_LEVELS) : [selected];
  const perOpponent = Number($("battleCount").value);
  const sides = fairSideSchedule(perOpponent);
  const totalGames = opponents.length * perOpponent;
  const summaries = Object.fromEntries(opponents.map((level) => [level, { win: 0, draw: 0, loss: 0, error: 0 }]));
  const total = { win: 0, draw: 0, loss: 0, error: 0 };
  battleRecords = [];
  battleRunning = true;
  battleStopRequested = false;
  $("runBattle").disabled = true;
  $("stopBattle").disabled = false;
  $("battleLogs").innerHTML = "<p>경기를 실행 중입니다…</p>";
  let completed = 0;

  try {
    for (const opponent of opponents) {
      for (const customSide of sides) {
        if (battleStopRequested) throw new Error("사용자가 대전을 중지했습니다.");
        $("battleStatus").textContent = `${AI_LEVELS[opponent].name} · ${customSide}`;
        const record = await runAutomatedMatch(code, customSide, opponent, completed + 1);
        battleRecords.push(record);
        summaries[opponent][record.log.result] += 1;
        if (record.log.error) summaries[opponent].error += 1;
        total[record.log.result] += 1;
        if (record.log.error) total.error += 1;
        completed += 1;
        updateBattleView(total, summaries, completed, totalGames);
        await delay(0);
      }
    }
    $("battleStatus").textContent = "대전 완료";
    setCodeMessage(`대전 완료 · ${total.win}승 ${total.draw}무 ${total.loss}패`, "ok");
  } catch (error) {
    $("battleStatus").textContent = battleStopRequested ? "중지됨" : "오류";
    setCodeMessage(error.message, battleStopRequested ? "" : "error");
  } finally {
    battleRunning = false;
    terminateCustomAIWorkers();
    $("runBattle").disabled = false;
    $("stopBattle").disabled = true;
    renderBattleLogs();
  }
}

async function runAutomatedMatch(code, customSide, opponent, sequence) {
  let matchState = initialState();
  const actions = [];
  const frames = [{ state: cloneState(matchState), label: "경기 시작" }];
  let error = null;

  while (!outcome(matchState)) {
    if (battleStopRequested) throw new Error("사용자가 대전을 중지했습니다.");
    const side = matchState.currentPlayer;
    const before = matchState;
    let choice;
    try {
      choice = side === customSide
        ? await runCustomAI(code, matchState)
        : chooseBuiltIn(matchState, opponent, { timeMs: 90, maxDepth: 5 });
    } catch (caught) {
      error = caught.message;
      matchState = cloneState(matchState);
      matchState.winner = side === "P1" ? "P2" : "P1";
      matchState.reason = `사용자 AI 오류: ${error}`;
      frames.push({ state: cloneState(matchState), label: matchState.reason });
      break;
    }
    const text = friendlyActionText(before, choice.action);
    matchState = applyAction(matchState, choice.action);
    const controls = relayControl(matchState).filter((relay) => relay.owner === side).length;
    actions.push({
      ply: matchState.ply,
      side,
      actor: side === customSide ? "내 AI" : AI_LEVELS[opponent].name,
      text,
      elapsedMs: choice.stats.elapsedMs,
      energy: matchState.energy[side],
      relays: controls,
      score: matchState.signalScores[side],
    });
    frames.push({ state: cloneState(matchState), label: `${side} · ${text}` });
    if (matchState.ply % 8 === 0) await delay(0);
  }

  const end = outcome(matchState);
  const result = !end.winner ? "draw" : end.winner === customSide ? "win" : "loss";
  return {
    frames,
    log: {
      rulesVersion: RULES_VERSION,
      sequence,
      opponent,
      opponentName: AI_LEVELS[opponent].name,
      customSide,
      codeFileName: $("editorFileName").textContent,
      result,
      reason: end.reason,
      plies: matchState.ply,
      timeoutMs: CUSTOM_AI_LIMITS.actionTimeMs,
      maxPlies: MAX_PLIES,
      playedAt: new Date().toLocaleString("ko-KR"),
      error,
      actions,
    },
  };
}

function updateBattleView(total, summaries, completed, totalGames) {
  $("wins").textContent = total.win;
  $("draws").textContent = total.draw;
  $("losses").textContent = total.loss;
  $("errors").textContent = total.error;
  $("battleProgress").textContent = `${completed} / ${totalGames}`;
  $("progressBar").style.width = `${completed / totalGames * 100}%`;
  $("resultRows").innerHTML = Object.entries(summaries).map(([level, score]) => `
    <tr><td>${escapeHtml(AI_LEVELS[level].name)}</td><td>${score.win}</td><td>${score.draw}</td><td>${score.loss}</td><td>${score.error}</td></tr>
  `).join("");
}

function renderBattleLogs() {
  const container = $("battleLogs");
  container.innerHTML = "";
  if (!battleRecords.length) {
    container.innerHTML = "<p>완료된 경기가 없습니다.</p>";
    return;
  }
  battleRecords.forEach((record, index) => {
    const row = document.createElement("div");
    row.className = "log-row";
    const label = document.createElement("span");
    label.textContent = `#${record.log.sequence} ${record.log.opponent.toUpperCase()} · ${record.log.customSide} · ${record.log.result.toUpperCase()} · ${record.log.reason}`;
    const replay = document.createElement("button");
    replay.textContent = "리플레이";
    replay.onclick = () => openReplay(index);
    const download = document.createElement("button");
    download.textContent = "TXT";
    download.onclick = () => downloadBattleLog(record.log);
    row.append(label, replay, download);
    container.appendChild(row);
  });
}

function stopBattle() {
  battleStopRequested = true;
  terminateCustomAIWorkers();
  $("stopBattle").disabled = true;
}

function openReplay(recordIndex) {
  const record = battleRecords[recordIndex];
  if (!record) return;
  replayFrames = record.frames;
  replayIndex = 0;
  $("replayTitle").textContent = `#${record.log.sequence} · ${record.log.opponentName}`;
  $("replayModal").hidden = false;
  showReplayFrame(0);
}

function showReplayFrame(index) {
  if (!replayFrames.length) return;
  replayIndex = Math.max(0, Math.min(replayFrames.length - 1, index));
  const frame = replayFrames[replayIndex];
  state = cloneState(frame.state);
  lastPosition = null;
  $("replayLabel").textContent = frame.label;
  $("replayCount").textContent = `${replayIndex + 1} / ${replayFrames.length}`;
  $("replayPrev").disabled = replayIndex === 0;
  $("replayNext").disabled = replayIndex === replayFrames.length - 1;
  render();
}

function closeReplay() {
  $("replayModal").hidden = true;
  replayFrames = [];
  state = initialState();
  moveEntries = [];
  mode = "idle";
  render();
}

function downloadBattleLog(log) {
  const url = URL.createObjectURL(new Blob([formatBattleLog(log)], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = battleLogFilename(log);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function loadCodeFile() {
  const file = $("fileInput").files?.[0];
  try {
    validateCustomFileMetadata(file);
    const code = await file.text();
    validateCustomCode(code);
    $("editor").value = code;
    $("editorFileName").textContent = file.name;
    storeCode(code);
    setCodeMessage(`${file.name}을 불러왔습니다.`, "ok");
  } catch (error) {
    setCodeMessage(error.message, "error");
  } finally {
    $("fileInput").value = "";
  }
}

function resetCode() {
  $("editor").value = STARTER_AI_CODE;
  $("editorFileName").textContent = "my-relay-ai.js";
  storeCode(STARTER_AI_CODE);
  setCodeMessage("시작용 AI를 복원했습니다.", "ok");
}

async function copySpec() {
  try {
    await navigator.clipboard.writeText(CUSTOM_AI_SPEC);
    setCodeMessage("LLM용 전체 규격을 복사했습니다.", "ok");
  } catch {
    setCodeMessage("클립보드가 차단되었습니다. 로컬 서버나 HTTPS에서 다시 시도하세요.", "error");
  }
}

function updateTelemetry(stats) {
  $("searchLevel").textContent = stats.level?.toUpperCase?.() ?? stats.source;
  $("searchNodes").textContent = `${Number(stats.nodes).toLocaleString()} nodes`;
  $("searchDepth").textContent = `depth ${stats.depth}`;
  $("searchTime").textContent = `${stats.elapsedMs} ms`;
}

function actionPosition(action, sourceState) {
  if (action.type === "extend") return action.to;
  if (action.type === "overload") return sourceState.nodes.find((item) => item.id === action.targetId)?.position ?? null;
  if (action.type === "fortify") return sourceState.nodes.find((item) => item.id === action.nodeId)?.position ?? null;
  if (action.type === "hack") return sourceState.cores.find((item) => item.id === action.targetId)?.position ?? null;
  return null;
}

function actionTag(action) {
  return { extend: "설치·1", overload: "제거·2", fortify: "방어·2", hack: "승리·3", swap: "교환", settle: "정산" }[action.type] ?? "";
}

function friendlyActionText(sourceState, action) {
  return actionText(sourceState, action)
    .replace(/^연결 /, "노드 설치 ")
    .replace(/^과부하 /, "적 노드 제거 ")
    .replace(/^강화 /, "노드 방어 ")
    .replace("상대 코어 해킹", "적 기지 해킹");
}

function setCodeMessage(text, type = "") {
  $("codeMessage").textContent = text;
  $("codeMessage").className = `code-message ${type}`;
}

function normalizeCode(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:javascript|js)?\s*\n?([\s\S]*?)\n?```$/i);
  return (match ? match[1] : trimmed).trim();
}

function loadStoredCode() {
  try { return localStorage.getItem("relay-forge-ai"); } catch { return null; }
}

function storeCode(code) {
  try { localStorage.setItem("relay-forge-ai", code); } catch { /* storage unavailable */ }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

setup();
