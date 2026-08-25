import {
  CUSTOM_AI_LIMITS,
  fairSideSchedule,
  runCustomAI,
  terminateCustomAIWorkers,
  validateCustomCode,
  validateCustomFileMetadata,
} from "./custom-ai-runner.js";

const WORKER_URL = new URL("./custom-ai-worker.js", import.meta.url);

export function mountArena(config) {
  const $ = (id) => document.getElementById(id);
  const { engine, ai } = config;
  let state = engine.initialState();
  let mode = "idle";
  let thinking = false;
  let session = 0;
  let moveEntries = [];
  let battleStopRequested = false;
  let battleRecords = [];
  let replayFrames = [];
  let replayIndex = 0;

  function setup() {
    for (const [level, info] of Object.entries(ai.AI_LEVELS)) {
      $("humanOpponent").add(new Option(info.name, level));
      $("battleOpponent").add(new Option(info.name, level));
    }
    $("humanOpponent").value = config.defaultOpponent ?? "v3";
    $("editor").value = loadCode() || config.starterCode;
    $("editorFileName").textContent = config.codeFileName;
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
    renderBattleResults();
    render();
  }

  function render() {
    const opponent = ai.AI_LEVELS[$("humanOpponent").value]?.name ?? "AI";
    $("gameView").innerHTML = config.renderGame(state, { mode, opponent, reveal: false });
    $("turnChip").textContent = engine.turnLabel(state);
    $("gameProgress").style.width = `${Math.max(0, Math.min(100, engine.progress(state) * 100))}%`;
    renderActions();
    $("moveLog").innerHTML = moveEntries.length
      ? moveEntries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")
      : `<li>${escapeHtml(config.emptyLog)}</li>`;
    $("moveLog").scrollTop = $("moveLog").scrollHeight;
  }

  function renderActions() {
    const canAct = mode === "human" && !thinking && state.currentPlayer === "P1" && !engine.outcome(state);
    const actions = canAct ? engine.legalActions(state) : [];
    $("actionGrid").innerHTML = actions.length
      ? actions.map((action) => `<button class="action-card ${escapeHtml(action.type)}" data-action="${escapeHtml(action.id)}">${config.actionMarkup(action, state)}</button>`).join("")
      : `<p class="action-placeholder">${escapeHtml(thinking ? "AI가 다음 수를 계산 중입니다…" : mode === "human" ? "상대 행동을 기다리는 중입니다." : "직접 플레이 또는 AI 관전을 시작하세요.")}</p>`;
    for (const button of $("actionGrid").querySelectorAll("[data-action]")) button.onclick = () => humanChoose(button.dataset.action);
  }

  function startHumanGame() {
    stopGame();
    mode = "human";
    state = engine.initialState({ seed: randomSeed(), forceFirst: "P1" });
    moveEntries = [];
    $("gameStatus").textContent = config.startMessage;
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
    const action = engine.legalActions(state).find((item) => item.id === actionId);
    if (!action) return;
    applyAndRecord(action, "YOU");
    render();
    if (finishVisibleGame()) return;
    thinking = true;
    render();
    const currentSession = session;
    while (mode === "human" && currentSession === session && !engine.outcome(state) && state.currentPlayer === "P2") {
      $("gameStatus").textContent = `${ai.AI_LEVELS[$("humanOpponent").value].name} 계산 중…`;
      await delay(140);
      if (mode !== "human" || currentSession !== session) return;
      const choice = ai.chooseAction(state, $("humanOpponent").value, { timeMs: 200, maxDepth: 5 });
      updateTelemetry(choice.stats);
      applyAndRecord(choice.action, ai.AI_LEVELS[$("humanOpponent").value].name);
      render();
    }
    thinking = false;
    render();
    if (!finishVisibleGame()) $("gameStatus").textContent = config.turnMessage(state);
  }

  async function watchGame() {
    stopGame();
    mode = "watch";
    state = engine.initialState({ seed: randomSeed() });
    moveEntries = [];
    const currentSession = session;
    render();
    while (mode === "watch" && currentSession === session && !engine.outcome(state)) {
      const level = state.currentPlayer === "P1" ? (config.watchLevels?.[0] ?? "v3") : (config.watchLevels?.[1] ?? "v4");
      $("gameStatus").textContent = `${ai.AI_LEVELS[level].name} 생각 중…`;
      await delay(90);
      if (mode !== "watch" || currentSession !== session) return;
      const choice = ai.chooseAction(state, level, { timeMs: 160, maxDepth: 5 });
      updateTelemetry(choice.stats);
      applyAndRecord(choice.action, ai.AI_LEVELS[level].name);
      render();
    }
    finishVisibleGame();
  }

  function applyAndRecord(action, actor) {
    const player = state.currentPlayer;
    state = engine.applyAction(state, action);
    moveEntries.push(`${state.ply}. ${player} ${actor} · ${engine.actionText(action, state)}`);
  }

  function finishVisibleGame() {
    const end = engine.outcome(state);
    if (!end) return false;
    mode = "idle";
    thinking = false;
    $("resultTitle").textContent = end.winner ? `${end.winner} 승리` : "무승부";
    $("resultReason").textContent = end.reason;
    $("resultModal").hidden = false;
    $("gameStatus").textContent = end.reason;
    render();
    return true;
  }

  async function testCode() {
    setCodeMessage("사용자 AI의 첫 행동을 검증 중입니다…");
    try {
      validateCustomCode($("editor").value);
      const testState = engine.initialState({ seed: 101, forceFirst: "P1" });
      const legal = engine.legalActions(testState);
      const choice = await runCustomAI($("editor").value, engine.publicState(testState, testState.currentPlayer), legal, WORKER_URL);
      setCodeMessage(`통과 · ${engine.actionText(choice.action, testState)} · ${choice.stats.elapsedMs}ms`, "ok");
    } catch (error) { setCodeMessage(error.message, "error"); }
  }

  async function startBattle() {
    try { validateCustomCode($("editor").value); } catch (error) { return setCodeMessage(error.message, "error"); }
    battleStopRequested = false;
    $("runBattle").disabled = true;
    $("stopBattle").disabled = false;
    battleRecords = [];
    const selected = $("battleOpponent").value;
    const opponents = selected === "all" ? Object.keys(ai.AI_LEVELS) : [selected];
    const count = Number($("battleCount").value);
    const jobs = [];
    let sequence = 1;
    for (const opponent of opponents) {
      for (const side of fairSideSchedule(count)) {
        jobs.push({ opponent, customSide: side, sequence, seed: 8400 + Math.floor((sequence - 1) / 2) });
        sequence += 1;
      }
    }
    updateBattleProgress(0, jobs.length);
    for (let index = 0; index < jobs.length && !battleStopRequested; index += 1) {
      battleRecords.push(await playCustomMatch(jobs[index]));
      renderBattleResults();
      updateBattleProgress(index + 1, jobs.length);
      await delay(0);
    }
    $("runBattle").disabled = false;
    $("stopBattle").disabled = true;
    setCodeMessage(battleStopRequested ? "대전을 중지했습니다." : `${battleRecords.length}경기 완료`, battleStopRequested ? "" : "ok");
  }

  async function playCustomMatch(job) {
    let match = engine.initialState({ seed: job.seed });
    const frames = [{ state: engine.cloneState(match), label: "경기 시작" }];
    const actions = [];
    let error = null;
    while (!engine.outcome(match)) {
      const side = match.currentPlayer;
      let choice;
      try {
        const legal = engine.legalActions(match);
        choice = side === job.customSide
          ? await runCustomAI($("editor").value, engine.publicState(match, side), legal, WORKER_URL)
          : ai.chooseAction(match, job.opponent, { timeMs: 100, maxDepth: 5 });
      } catch (caught) {
        error = caught.message;
        match = engine.cloneState(match);
        match.winner = side === "P1" ? "P2" : "P1";
        match.reason = `사용자 AI 오류: ${error}`;
        break;
      }
      match = engine.applyAction(match, choice.action);
      const text = engine.actionText(choice.action, match);
      actions.push({ ply: match.ply, side, actor: side === job.customSide ? "내 AI" : ai.AI_LEVELS[job.opponent].name, text, elapsedMs: choice.stats.elapsedMs });
      frames.push({ state: engine.cloneState(match), label: `${side} · ${text}` });
    }
    const end = engine.outcome(match);
    const result = error ? "error" : !end.winner ? "draw" : end.winner === job.customSide ? "win" : "loss";
    return { frames, log: { sequence: job.sequence, seed: job.seed, opponent: job.opponent, opponentName: ai.AI_LEVELS[job.opponent].name, customSide: job.customSide, result, reason: end.reason, plies: match.ply, actions, error } };
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
    $("battleLogs").innerHTML = battleRecords.length
      ? battleRecords.map((record, index) => `<div class="battle-log-row"><span>#${record.log.sequence} · ${record.log.customSide} · ${record.log.result.toUpperCase()} · seed ${record.log.seed}</span><button data-replay="${index}">리플레이</button><button data-log="${index}">로그</button></div>`).join("")
      : `<p>완료된 경기의 로그와 리플레이가 표시됩니다.</p>`;
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
    $("replayCounter").textContent = `${replayIndex + 1} / ${replayFrames.length}`;
    $("replayLabel").textContent = frame.label;
    $("replayState").innerHTML = config.renderGame(frame.state, { mode: "replay", opponent: "AI", reveal: true });
    $("replayPrev").disabled = replayIndex === 0;
    $("replayNext").disabled = replayIndex === replayFrames.length - 1;
  }

  function closeReplay() { $("replayModal").hidden = true; replayFrames = []; }

  function downloadLog(index) {
    const log = battleRecords[index].log;
    const lines = [config.title, `규칙 ${config.gameId} / ${engine.RULES_VERSION}`, `경기 #${log.sequence} · seed ${log.seed}`, `내 진영 ${log.customSide} · 상대 ${log.opponentName}`, `결과 ${log.result} · ${log.reason}`, "", ...log.actions.map((item) => `${item.ply}. ${item.side} ${item.actor} · ${item.text} · ${item.elapsedMs ?? 0}ms`)];
    downloadText(`${config.gameId}-${log.seed}-${log.sequence}-${log.result}.txt`, `${lines.join("\n")}\n`);
  }

  function updateTelemetry(stats) {
    $("searchLevel").textContent = stats.level?.toUpperCase?.() ?? "AI";
    $("searchNodes").textContent = `${Number(stats.nodes ?? 0).toLocaleString()} nodes`;
    $("searchDepth").textContent = `depth ${stats.depth ?? "—"}`;
    $("searchTime").textContent = `${stats.elapsedMs ?? 0} ms`;
  }

  function updateBattleProgress(done, total) {
    $("battleProgressText").textContent = `${done} / ${total}`;
    $("battleProgressBar").style.width = `${total ? done / total * 100 : 0}%`;
  }

  function resetCode() {
    $("editor").value = config.starterCode;
    $("editorFileName").textContent = config.codeFileName;
    storeCode(config.starterCode);
    setCodeMessage("예제 AI를 복원했습니다.", "ok");
  }

  async function copySpec() {
    try { await navigator.clipboard.writeText(config.spec); setCodeMessage("프롬프트를 복사했습니다.", "ok"); }
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

  function setCodeMessage(text, type = "") { $("codeMessage").textContent = text; $("codeMessage").className = `code-message ${type}`; }
  function loadCode() { try { return localStorage.getItem(config.storageKey); } catch { return null; } }
  function storeCode(code) { try { localStorage.setItem(config.storageKey, code); } catch { /* unavailable */ } }
  setup();
}

function randomSeed() { return Math.floor(Date.now() % 1_000_000_000); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function downloadText(filename, contents) { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" })); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }

export { CUSTOM_AI_LIMITS };
