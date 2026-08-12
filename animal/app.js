import {
  PIECE_INFO,
  applyMove,
  cloneState,
  initialState,
  legalMoves,
  moveNotation,
  sameMove,
  stateKey,
  withDraw,
} from "./engine.js";
import { AI_LEVELS, chooseMove } from "./ai.js?v=20260812-web-cleanup";
import { battleLogFilename, battleResultLabel, fairSideSchedule, formatBattleLog } from "./battle-log.js?v=20260812-fair-sides";
import {
  CUSTOM_AI_LIMITS,
  CUSTOM_AI_SPEC,
  STARTER_AI_CODE,
  runCustomAI,
  terminateCustomAIWorkers,
  validateCustomCode,
  validateCustomFileMetadata,
} from "./custom-ai-runner.js?v=20260812-file-import";

const $ = (id) => document.getElementById(id);
const levelOrder = ["v1", "v2", "v3", "v4", "v5"];

let state;
let repetition;
let snapshots;
let log;
let selected = null;
let lastMove = null;
let busy = false;
let autoMode = false;
let session = 0;
let tournamentRunning = false;
let tournamentToken = 0;
let benchmarkLogs = [];

function initializeControls() {
  for (const level of levelOrder) {
    const info = AI_LEVELS[level];
    for (const select of [$("p1Select"), $("p2Select")]) {
      const option = document.createElement("option");
      option.value = level;
      option.textContent = info.name;
      select.appendChild(option);
    }
    const battleOption = document.createElement("option");
    battleOption.value = level;
    battleOption.textContent = AI_LEVELS[level].name;
    $("battleOpponent").appendChild(battleOption);
  }
  for (const select of [$("p1Select"), $("p2Select")]) {
    const option = document.createElement("option");
    option.value = "custom";
    option.textContent = "내 AI 코드";
    select.appendChild(option);
  }
  $("p1Select").value = "human";
  $("p2Select").value = "v5";
  $("customEditor").value = localStorage.getItem("animal-shogi-custom-ai") || STARTER_AI_CODE;

  const power = [18, 35, 55, 76, 100];
  $("levelCards").innerHTML = levelOrder.map((level, index) => {
    const info = AI_LEVELS[level];
    const technique = ["무작위 표본", "정적 평가", "미니맥스", "알파베타 + TT", "반복 심화 + TT"][index];
    return `<article class="level-card ${level === "v5" ? "active" : ""}" data-version="${level.toUpperCase()}" style="--power:${power[index]}%">
      <span class="bar"></span><b>${info.name}</b><small>${technique}</small><p>${info.description}</p>
    </article>`;
  }).join("");
  updatePlayerLabels();
}

function newGame({ auto = false } = {}) {
  session += 1;
  terminateCustomAIWorkers();
  state = initialState();
  repetition = new Map([[stateKey(state), 1]]);
  snapshots = [];
  log = [];
  selected = null;
  lastMove = null;
  busy = false;
  autoMode = auto;
  closeModal();
  resetTelemetry();
  saveSnapshot();
  render();
  setStatus(auto ? "AI 자동 대국을 시작합니다." : "말을 선택한 뒤 표시된 칸으로 이동하세요.");
  if (playerType(state.turn) !== "human") scheduleAI();
}

function playerType(player) {
  return $(player === "P1" ? "p1Select" : "p2Select").value;
}

function render() {
  renderBoard();
  renderHands();
  renderLog();
  updatePlayerLabels();
  const label = state.winner ? "대국 종료" : `${state.turn === "P1" ? "P1" : "P2"} 차례`;
  $("turnPill").textContent = label;
  $("undo").disabled = busy || snapshots.length <= 1;
}

function renderBoard() {
  const moves = legalMoves(state);
  const destinations = selected ? moves.filter((move) => {
    if (selected.type === "drop") return move.type === "drop" && move.piece === selected.piece;
    return move.type === "move" && move.from === selected.from;
  }) : [];

  $("board").innerHTML = "";
  state.board.forEach((item, index) => {
    const cell = document.createElement("button");
    cell.className = "cell";
    cell.type = "button";
    cell.setAttribute("aria-label", item ? `${PIECE_INFO[item.type].name} ${item.owner}` : `빈칸 ${index + 1}`);
    if (lastMove?.to === index) cell.classList.add("last");
    if (item?.owner === state.turn && moves.some((move) => move.type === "move" && move.from === index)) cell.classList.add("selectable");
    if (selected?.from === index) cell.classList.add("selected");
    if (destinations.some((move) => move.to === index)) {
      cell.classList.add("destination");
      if (item) cell.classList.add("capture");
    }
    if (item) {
      cell.innerHTML = `<span class="piece ${item.owner.toLowerCase()}">${PIECE_INFO[item.type].symbol}<small>${item.owner}</small></span>`;
    }
    cell.onclick = () => boardClick(index);
    $("board").appendChild(cell);
  });
}

function renderHands() {
  for (const player of ["P1", "P2"]) {
    const hand = $(player === "P1" ? "p1Hand" : "p2Hand");
    hand.innerHTML = "";
    for (const type of ["chick", "elephant", "giraffe"]) {
      const count = state.hands[player][type];
      for (let number = 0; number < count; number += 1) {
        const button = document.createElement("button");
        button.className = `hand-piece ${selected?.type === "drop" && selected.piece === type ? "selected" : ""}`;
        button.textContent = PIECE_INFO[type].symbol;
        button.title = `${PIECE_INFO[type].name} 놓기`;
        button.disabled = busy || state.turn !== player || playerType(player) !== "human";
        button.onclick = () => {
          selected = { type: "drop", piece: type };
          setStatus(`${PIECE_INFO[type].name}을 놓을 빈칸을 선택하세요.`);
          renderBoard();
          renderHands();
        };
        hand.appendChild(button);
      }
    }
  }
}

function renderLog() {
  if (!log.length) {
    $("moveLog").innerHTML = '<li class="empty">아직 둔 수가 없습니다.</li>';
    return;
  }
  $("moveLog").innerHTML = log.map((entry) => `<li>${entry.player} ${escapeHtml(entry.notation)}</li>`).join("");
  $("moveLog").scrollTop = $("moveLog").scrollHeight;
}

function boardClick(index) {
  if (busy || state.winner || playerType(state.turn) !== "human") return;
  const item = state.board[index];
  const moves = legalMoves(state);

  if (item?.owner === state.turn) {
    selected = { type: "move", from: index };
    setStatus(`${PIECE_INFO[item.type].name}의 목적지를 선택하세요.`);
    renderBoard();
    return;
  }

  if (!selected) return;
  const requested = moves.find((move) => {
    if (move.to !== index) return false;
    return selected.type === "drop"
      ? move.type === "drop" && move.piece === selected.piece
      : move.type === "move" && move.from === selected.from;
  });
  if (!requested) {
    setStatus("그 칸으로는 이동할 수 없습니다.");
    return;
  }
  playMove(requested);
}

function playMove(move, aiResult = null) {
  const before = state;
  const notation = moveNotation(before, move);
  const player = before.turn;
  state = applyMove(before, move);
  lastMove = move;
  selected = null;
  log.push({ player, notation });

  if (!state.winner) {
    const key = stateKey(state);
    const count = (repetition.get(key) ?? 0) + 1;
    repetition.set(key, count);
    if (count >= 3) state = withDraw(state);
  }

  if (aiResult) updateTelemetry(aiResult, notation);
  saveSnapshot();
  render();

  if (state.winner) {
    finishGame();
    return;
  }
  setStatus(`${state.turn}의 차례입니다.`);
  if (playerType(state.turn) !== "human") scheduleAI();
}

function scheduleAI() {
  if (busy || state.winner) return;
  const activeSession = session;
  busy = true;
  selected = null;
  render();
  const scheduledLevel = playerType(state.turn);
  setStatus(`${playerDisplayName(scheduledLevel)}이 수를 읽고 있습니다…`);
  window.setTimeout(async () => {
    if (activeSession !== session || state.winner) return;
    try {
      const level = playerType(state.turn);
      const answer = level === "custom"
        ? await runCustomAI($("customEditor").value, state)
        : chooseMove(state, level, { timeMs: autoMode ? 90 : undefined });
      if (activeSession !== session) return;
      busy = false;
      if (!answer.move) throw new Error("둘 수 있는 수가 없습니다.");
      playMove(answer.move, answer);
    } catch (error) {
      if (activeSession !== session) return;
      busy = false;
      setStatus(`AI 오류: ${error.message}`);
      render();
    }
  }, autoMode ? 45 : 110);
}

function saveSnapshot() {
  snapshots.push({
    state: cloneState(state),
    repetition: new Map(repetition),
    log: log.map((entry) => ({ ...entry })),
    lastMove: lastMove ? { ...lastMove } : null,
  });
}

function undo() {
  if (busy || snapshots.length <= 1) return;
  session += 1;
  snapshots.pop();
  // 사람 대 AI에서는 AI의 응수까지 함께 되돌려 사람 차례로 맞춘다.
  while (snapshots.length > 1 && playerType(snapshots.at(-1).state.turn) !== "human") snapshots.pop();
  const previous = snapshots.at(-1);
  state = cloneState(previous.state);
  repetition = new Map(previous.repetition);
  log = previous.log.map((entry) => ({ ...entry }));
  lastMove = previous.lastMove ? { ...previous.lastMove } : null;
  selected = null;
  autoMode = false;
  closeModal();
  render();
  setStatus("이전 국면으로 되돌렸습니다.");
}

function hint() {
  if (busy || state.winner || playerType(state.turn) !== "human") {
    setStatus("사람 차례에만 추천 수를 분석할 수 있습니다.");
    return;
  }
  busy = true;
  setStatus("v5가 추천 수를 분석하고 있습니다…");
  window.setTimeout(() => {
    const answer = chooseMove(state, "v5", { timeMs: 260 });
    busy = false;
    if (answer.move.type === "drop") selected = { type: "drop", piece: answer.move.piece };
    else selected = { type: "move", from: answer.move.from };
    updateTelemetry(answer, moveNotation(state, answer.move));
    render();
    setStatus(`추천: ${moveNotation(state, answer.move)} · 초록 점을 선택하면 실행됩니다.`);
  }, 30);
}

function startAutoPlay() {
  if (busy) return;
  if ($("p1Select").value === "human") $("p1Select").value = "v4";
  if ($("p2Select").value === "human") $("p2Select").value = "v5";
  updatePlayerLabels();
  newGame({ auto: true });
}

function finishGame() {
  busy = false;
  autoMode = false;
  const isDraw = state.winner === "DRAW";
  $("resultKicker").textContent = isDraw ? "THREEFOLD REPETITION" : "GAME OVER";
  $("resultTitle").textContent = isDraw ? "무승부" : `${state.winner} 승리`;
  $("resultReason").textContent = state.reason;
  $("resultModal").hidden = false;
  setStatus(`${$("resultTitle").textContent} · ${state.reason}`);
}

function closeModal() {
  $("resultModal").hidden = true;
}

function updatePlayerLabels() {
  for (const player of ["P1", "P2"]) {
    const value = playerType(player);
    $(player === "P1" ? "p1Name" : "p2Name").textContent = playerDisplayName(value);
  }
  const selectedLevel = $("p2Select").value === "human" ? $("p1Select").value : $("p2Select").value;
  $("levelDetail").textContent = selectedLevel === "human"
    ? "두 선수를 설정한 뒤 새 대국 또는 AI끼리 1판을 선택하세요."
    : selectedLevel === "custom"
      ? "내 AI 코드 · 아래 코드 편집기의 chooseMove(state, me)를 매 수 실행합니다."
      : `${AI_LEVELS[selectedLevel].name} · ${AI_LEVELS[selectedLevel].description}`;
  document.querySelectorAll(".level-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.version.toLowerCase() === selectedLevel);
  });
}

function updateTelemetry(answer, notation) {
  const stats = answer.stats;
  $("nodes").textContent = (stats.nodes ?? 0).toLocaleString();
  $("depth").textContent = String(stats.depth ?? 0);
  $("elapsed").textContent = `${stats.elapsedMs ?? 0} ms`;
  $("tableHits").textContent = (stats.tableHits ?? 0).toLocaleString();
  $("chosenMove").textContent = notation;
  $("sourceChip").textContent = stats.exact ? "심화 결과" : sourceLabel(stats.source);
}

function resetTelemetry() {
  $("nodes").textContent = "0";
  $("depth").textContent = "0";
  $("elapsed").textContent = "0 ms";
  $("tableHits").textContent = "0";
  $("chosenMove").textContent = "—";
  $("sourceChip").textContent = "대기";
}

function sourceLabel(source) {
  return { random: "무작위", heuristic: "정적 평가", search: "고정 탐색", "iterative-search": "반복 심화", tablebase: "심화 탐색", "custom-code": "내 AI 코드" }[source] ?? "탐색";
}

function playerDisplayName(type) {
  if (type === "human") return "사람";
  if (type === "custom") return "내 AI 코드";
  return AI_LEVELS[type]?.name ?? type;
}

async function testCustomCode() {
  if (tournamentRunning) return;
  const button = $("testCode");
  button.disabled = true;
  setCodeStatus("초기 국면에서 한 수를 실행하고 있습니다…");
  try {
    const testState = initialState();
    const answer = await runCustomAI($("customEditor").value, testState);
    const notation = moveNotation(testState, answer.move);
    setCodeStatus(`검증 성공 · ${notation} · ${answer.stats.elapsedMs}ms`, "success");
  } catch (error) {
    setCodeStatus(`검증 실패 · ${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

async function copyCustomSpec() {
  try {
    await navigator.clipboard.writeText(`${CUSTOM_AI_SPEC}\n\n[시작 예제]\n${STARTER_AI_CODE}`);
    setCodeStatus("LLM에 전달할 함수 규격과 예제 코드를 복사했습니다.", "success");
  } catch {
    setCodeStatus("클립보드 접근이 차단됐습니다. 아래 규격 보기를 펼쳐 직접 복사하세요.", "error");
  }
}

async function loadCustomAIFile(file) {
  try {
    validateCustomFileMetadata(file);
    const code = await file.text();
    const bytes = new TextEncoder().encode(code).length;
    if (!code.trim()) throw new Error("선택한 파일이 비어 있습니다.");
    if (bytes > CUSTOM_AI_LIMITS.codeBytes) throw new Error("AI 파일은 50KB 이하여야 합니다.");

    $("customEditor").value = code;
    $("editorFileName").textContent = file.name;
    localStorage.setItem("animal-shogi-custom-ai", code);
    try {
      validateCustomCode(code);
      setCodeStatus(`${file.name} 전체 ${bytes.toLocaleString()}바이트를 불러왔습니다.`, "success");
    } catch (error) {
      setCodeStatus(`${file.name}은 불러왔지만 확인이 필요합니다: ${error.message}`, "error");
    }
  } catch (error) {
    setCodeStatus(`파일 불러오기 실패 · ${error.message}`, "error");
  } finally {
    $("codeFileInput").value = "";
  }
}

async function runBenchmarkBattle() {
  if (tournamentRunning) return;
  const code = $("customEditor").value;
  try {
    validateCustomCode(code);
  } catch (error) {
    setCodeStatus(error.message, "error");
    return;
  }

  const selectedOpponent = $("battleOpponent").value;
  const opponents = selectedOpponent === "all" ? [...levelOrder] : [selectedOpponent];
  const gamesPerOpponent = Number($("battleCount").value);
  let sideSchedule;
  try {
    sideSchedule = fairSideSchedule(gamesPerOpponent);
  } catch (error) {
    setBattleNote(error.message, "error");
    return;
  }
  const totalGames = opponents.length * gamesPerOpponent;
  const results = Object.fromEntries(opponents.map((level) => [level, { win: 0, draw: 0, loss: 0, errors: 0 }]));
  const total = { win: 0, draw: 0, loss: 0, errors: 0 };
  const token = ++tournamentToken;
  let completed = 0;

  tournamentRunning = true;
  $("runBattle").disabled = true;
  $("stopBattle").disabled = false;
  $("testCode").disabled = true;
  $("battleTableBody").innerHTML = "";
  benchmarkLogs = [];
  renderBattleLogs();
  updateBattleSummary(total, completed, totalGames, results);
  setBattleNote(`상대마다 내 AI가 선공 P1 ${gamesPerOpponent / 2}경기, 후공 P2 ${gamesPerOpponent / 2}경기를 번갈아 맡습니다.`);

  try {
    for (const opponent of opponents) {
      for (let game = 0; game < gamesPerOpponent; game += 1) {
        if (token !== tournamentToken) return;
        const customSide = sideSchedule[game];
        const sideName = customSide === "P1" ? "선공" : "후공";
        $("battleStatus").textContent = `${AI_LEVELS[opponent].name} · ${game + 1}/${gamesPerOpponent} · 내 AI ${sideName} ${customSide}`;
        let outcome;
        try {
          outcome = await playBenchmarkGame(code, opponent, customSide, token);
        } catch (error) {
          if (token !== tournamentToken) return;
          outcome = { result: "loss", plies: 0, error: error.message, reason: "대전 실행 오류", moves: [] };
        }
        results[opponent][outcome.result] += 1;
        total[outcome.result] += 1;
        if (outcome.error) {
          results[opponent].errors += 1;
          total.errors += 1;
          setBattleNote(`${AI_LEVELS[opponent].name}전 오류 · ${outcome.error}`, "error");
        } else {
          setBattleNote(`${AI_LEVELS[opponent].name}전 ${outcome.result === "win" ? "승리" : outcome.result === "draw" ? "무승부" : "패배"} · ${outcome.plies}수`);
        }
        completed += 1;
        benchmarkLogs.push({
          id: `match-${completed}`,
          sequence: completed,
          opponent,
          opponentName: AI_LEVELS[opponent].name,
          gameNumber: game + 1,
          customSide,
          codeFileName: $("editorFileName").textContent,
          result: outcome.result,
          reason: outcome.reason,
          plies: outcome.plies,
          error: outcome.error,
          moves: outcome.moves ?? [],
          playedAt: new Date().toLocaleString("ko-KR", { hour12: false }),
        });
        renderBattleLogs();
        updateBattleSummary(total, completed, totalGames, results);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    $("battleStatus").textContent = "대전 완료";
    setBattleNote(`${completed}경기 완료 · 선공 ${completed / 2}경기 / 후공 ${completed / 2}경기 · 내 AI 승률 ${Math.round(total.win / Math.max(1, completed) * 100)}%`, total.errors ? "error" : "");
  } finally {
    if (token === tournamentToken) {
      tournamentRunning = false;
      $("runBattle").disabled = false;
      $("stopBattle").disabled = true;
      $("testCode").disabled = false;
    }
  }
}

async function playBenchmarkGame(code, opponent, customSide, token) {
  let matchState = initialState();
  const seen = new Map([[stateKey(matchState), 1]]);
  const moves = [];

  for (let ply = 0; ply < CUSTOM_AI_LIMITS.maxPlies && !matchState.winner; ply += 1) {
    if (token !== tournamentToken) throw new Error("대전이 중지되었습니다.");
    const available = legalMoves(matchState);
    if (!available.length) {
      return { result: matchState.turn === customSide ? "loss" : "win", plies: ply, error: null, reason: "합법 수가 없습니다.", moves };
    }
    let answer;
    try {
      answer = matchState.turn === customSide
        ? await runCustomAI(code, matchState)
        : chooseMove(matchState, opponent, { timeMs: opponent === "v5" ? 45 : undefined, maxDepth: 10 });
      if (!answer.move) throw new Error("AI가 수를 반환하지 않았습니다.");
    } catch (error) {
      if (token !== tournamentToken) throw error;
      const failedActor = matchState.turn === customSide ? "내 AI" : AI_LEVELS[opponent].name;
      return {
        result: matchState.turn === customSide ? "loss" : "win",
        plies: moves.length,
        error: error.message,
        reason: `${failedActor} 실행 오류`,
        moves,
      };
    }
    moves.push({
      ply: moves.length + 1,
      side: matchState.turn,
      actor: matchState.turn === customSide ? "내 AI" : AI_LEVELS[opponent].name,
      notation: moveNotation(matchState, answer.move),
      elapsedMs: answer.stats?.elapsedMs,
    });
    matchState = applyMove(matchState, answer.move);
    if (!matchState.winner) {
      const key = stateKey(matchState);
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count >= 3) matchState = withDraw(matchState);
    }
  }

  const plies = matchState.ply ?? CUSTOM_AI_LIMITS.maxPlies;
  if (!matchState.winner) return { result: "draw", plies, error: null, reason: `${CUSTOM_AI_LIMITS.maxPlies}수 제한에 도달했습니다.`, moves };
  if (matchState.winner === "DRAW") return { result: "draw", plies, error: null, reason: matchState.reason, moves };
  return {
    result: matchState.winner === customSide ? "win" : "loss",
    plies,
    error: null,
    reason: matchState.reason || `${matchState.winner}이 승리했습니다.`,
    moves,
  };
}

function stopBenchmarkBattle() {
  if (!tournamentRunning) return;
  tournamentToken += 1;
  tournamentRunning = false;
  terminateCustomAIWorkers();
  $("runBattle").disabled = false;
  $("stopBattle").disabled = true;
  $("testCode").disabled = false;
  $("battleStatus").textContent = "사용자가 중지함";
  setBattleNote("진행 중인 대전을 중지했습니다.");
}

function updateBattleSummary(total, completed, totalGames, results) {
  $("battleWins").textContent = total.win;
  $("battleDraws").textContent = total.draw;
  $("battleLosses").textContent = total.loss;
  $("battleRate").textContent = `${Math.round(total.win / Math.max(1, completed) * 100)}%`;
  $("battleProgressText").textContent = `${completed} / ${totalGames}`;
  $("battleBar").style.width = `${completed / Math.max(1, totalGames) * 100}%`;
  $("battleTableBody").innerHTML = Object.entries(results).map(([level, score]) => {
    const games = score.win + score.draw + score.loss;
    const rate = Math.round(score.win / Math.max(1, games) * 100);
    return `<tr><td>${escapeHtml(AI_LEVELS[level].name)}</td><td>${score.win}</td><td>${score.draw}</td><td>${score.loss}</td><td>${rate}%</td><td>${score.errors}</td></tr>`;
  }).join("");
}

function renderBattleLogs() {
  if (!benchmarkLogs.length) {
    $("battleLogList").innerHTML = '<p class="match-log-empty">대전을 완료하면 경기별 로그가 표시됩니다.</p>';
    return;
  }
  $("battleLogList").innerHTML = benchmarkLogs.map((battleLog) => {
    const downloadUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(`\uFEFF${formatBattleLog(battleLog)}`)}`;
    return `
    <article class="match-log-item">
      <div class="match-log-head">
        <div><b>#${battleLog.sequence} · ${escapeHtml(battleLog.opponentName)}</b><span>내 AI ${battleLog.customSide === "P1" ? "선공 P1" : "후공 P2"} · ${battleResultLabel(battleLog.result)} · ${battleLog.plies}수</span></div>
        <div class="match-log-actions">
          <button data-log-action="copy" data-log-id="${battleLog.id}" aria-label="${battleLog.sequence}번 경기 로그 복사">복사</button>
          <a href="${downloadUrl}" download="${battleLogFilename(battleLog)}" data-log-action="download" data-log-id="${battleLog.id}" aria-label="${battleLog.sequence}번 경기 로그 다운로드">다운로드</a>
        </div>
      </div>
      <details><summary>수순 ${battleLog.moves.length}개 보기</summary><pre>${escapeHtml(formatBattleLog(battleLog))}</pre></details>
    </article>`;
  }).join("");
}

async function copyBattleLog(battleLog) {
  try {
    await navigator.clipboard.writeText(formatBattleLog(battleLog));
    setBattleNote(`#${battleLog.sequence} 경기 로그를 클립보드에 복사했습니다.`, "success");
  } catch {
    setBattleNote("클립보드 접근이 차단되어 로그를 복사하지 못했습니다.", "error");
  }
}

function setCodeStatus(message, type = "") {
  $("codeStatus").textContent = message;
  $("codeStatus").className = `code-status ${type}`.trim();
}

function setBattleNote(message, type = "") {
  $("battleNote").textContent = message;
  $("battleNote").className = `battle-note ${type}`.trim();
}

function setStatus(message) {
  $("status").textContent = message;
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

$("newGame").onclick = () => newGame();
$("modalNewGame").onclick = () => newGame();
$("closeModal").onclick = closeModal;
$("undo").onclick = undo;
$("hint").onclick = hint;
$("autoPlay").onclick = startAutoPlay;
$("clearLog").onclick = () => { log = []; renderLog(); };
$("p1Select").onchange = updatePlayerLabels;
$("p2Select").onchange = updatePlayerLabels;
$("resultModal").onclick = (event) => { if (event.target === $("resultModal")) closeModal(); };
$("customEditor").addEventListener("input", () => {
  localStorage.setItem("animal-shogi-custom-ai", $("customEditor").value);
  setCodeStatus("코드를 수정했습니다. 브라우저에 자동 저장됐습니다.");
});
$("customEditor").addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  const editor = event.currentTarget;
  const start = editor.selectionStart;
  editor.setRangeText("  ", start, editor.selectionEnd, "end");
  editor.dispatchEvent(new Event("input"));
});
$("resetCode").onclick = () => {
  $("customEditor").value = STARTER_AI_CODE;
  $("editorFileName").textContent = "my-animal-ai.js";
  localStorage.setItem("animal-shogi-custom-ai", STARTER_AI_CODE);
  setCodeStatus("시작 예제 코드를 복원했습니다.", "success");
};
$("uploadCode").onclick = () => $("codeFileInput").click();
$("codeFileInput").onchange = (event) => loadCustomAIFile(event.target.files?.[0]);
$("copySpec").onclick = copyCustomSpec;
$("testCode").onclick = testCustomCode;
$("runBattle").onclick = runBenchmarkBattle;
$("stopBattle").onclick = stopBenchmarkBattle;
$("battleLogList").onclick = (event) => {
  const control = event.target.closest("[data-log-action]");
  if (!control) return;
  const battleLog = benchmarkLogs.find((item) => item.id === control.dataset.logId);
  if (!battleLog) return;
  if (control.dataset.logAction === "copy") copyBattleLog(battleLog);
  if (control.dataset.logAction === "download") setBattleNote(`#${battleLog.sequence} 경기 로그 파일을 다운로드했습니다.`, "success");
};

initializeControls();
newGame();
