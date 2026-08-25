import * as engine from "./engine.js";
import * as ai from "./ai.js";
import { CUSTOM_AI_LIMITS, CustomAISession, validateCustomCode } from "./custom-ai-runner.js";

const STARTER_AI_CODE = `function chooseAction(state, me) {
  const car = state.cars[me];
  const road = state.road;
  const curve30 = road.lookahead.find(p => p.distance === 30);
  const curve45 = road.lookahead.find(p => p.distance === 45);

  // 중앙으로 돌아오면서 다가오는 커브 방향을 미리 조향합니다.
  const demand = -car.lateralOffset * 0.065
    - car.headingError * 1.4
    + curve30.curvature * car.speed * 2.2
    + curve45.curvature * car.speed * 1.1;
  const steering = demand < -0.72 ? -1
    : demand < -0.18 ? -0.5
    : demand > 0.72 ? 1
    : demand > 0.18 ? 0.5 : 0;

  // 전방 12~90m 중 가장 낮은 권장 속도에 맞춥니다.
  const targetSpeed = Math.min(
    ...road.lookahead.slice(2).map(p => p.recommendedSpeed)
  );
  let throttle = car.speed > targetSpeed + 7 ? -1
    : car.speed < targetSpeed - 1 ? 1 : 0;
  if (Math.abs(car.lateralOffset) > 19) throttle = car.speed > 18 ? -1 : 1;

  return state.legalActions.find(action =>
    action.throttle === throttle && action.steering === steering
  );
}`;

const SPEC = `[Vector Racing AI 전체 규격]
chooseAction(state, me)를 작성하세요. 게임은 고정 15 TPS이며 fixedDt는 1/15초입니다. 매 틱 legalActions 15개(스로틀 -1 브레이크, 0 유지, 1 가속 × 조향 -1, -0.5, 0, 0.5, 1) 중 하나를 동기 반환합니다.

state: gameId, rulesVersion, seed, tick, ticksPerSecond, fixedDt, maxTicks, lapsToWin, trackLength, currentPlayer, cars, road, lastActions, legalActions.
cars.P1/P2: x, y, heading(rad), speed(m/s), speedKph, progress, totalProgress, lateralOffset(양수=도로 오른쪽), headingError(rad), lap(0부터), incidents, lastActionId.
road.nearest: progress, lateralOffset, headingError, centerX/Y.
road.edgeDistance: left, right. 음수면 이미 해당 경계를 벗어났습니다.
road.lookahead: 0, 6, 12, 20, 30, 45, 65, 90m 전방의 distance, centerX/Y, heading(rad), curvature(양수=우커브), halfWidth, recommendedSpeed(m/s).
도로 반폭은 24m입니다. 잔디에서는 가속·조향 성능이 낮아지고, 경계 밖 25m에서 감속·복귀되며 incidents가 증가합니다. 차량끼리는 충돌하지 않습니다. 3랩을 먼저 완주하거나 200초 후 더 멀리 간 차량이 승리합니다.
코드 50KB, 행동당 최대 500ms, Promise 금지, 네트워크/DOM/저장소 API 사용 금지. 상태는 깊게 동결되며 반환값은 legalActions와 다시 대조됩니다.

${STARTER_AI_CODE}`;

const $ = (id) => document.getElementById(id);
const canvas = $("raceCanvas");
const context = canvas.getContext("2d");
let state = engine.initialState();
let trackSeed = state.seed;
let mode = "idle";
let loopGeneration = 0;
let activeCustomSession = null;
let battleStopRequested = false;
let battleRecords = [];
let replayTimer = null;
let replayRecord = null;
const held = new Set();

setup();

function setup() {
  for (const [level, info] of Object.entries(ai.AI_LEVELS)) {
    $("opponentSelect").add(new Option(info.name, level));
    $("battleOpponent").add(new Option(info.name, level));
  }
  $("opponentSelect").value = "v4";
  $("editor").value = loadCode() || STARTER_AI_CODE;
  $("editor").addEventListener("input", () => storeCode($("editor").value));
  $("manualRace").onclick = () => startVisibleRace("manual");
  $("codeRace").onclick = () => startVisibleRace("custom");
  $("watchRace").onclick = () => startVisibleRace("watch");
  $("stopRace").onclick = () => stopVisibleRace("세션을 중지했습니다.");
  $("newTrack").onclick = newTrack;
  $("uploadCode").onclick = () => $("fileInput").click();
  $("fileInput").onchange = loadCodeFile;
  $("resetCode").onclick = resetCode;
  $("loadStrongCode").onclick = loadStrongCode;
  $("copySpec").onclick = copySpec;
  $("testCode").onclick = testCode;
  $("runBattle").onclick = startBattle;
  $("stopBattle").onclick = stopBattle;
  $("closeResult").onclick = () => $("resultModal").hidden = true;
  $("closeReplay").onclick = closeReplay;
  $("replayToggle").onclick = toggleReplay;
  $("replayRange").oninput = () => showReplayFrame(Number($("replayRange").value));
  $("resultModal").onclick = (event) => { if (event.target === $("resultModal")) $("resultModal").hidden = true; };
  $("replayModal").onclick = (event) => { if (event.target === $("replayModal")) closeReplay(); };
  window.addEventListener("keydown", handleKey);
  window.addEventListener("keyup", handleKey);
  window.addEventListener("blur", () => held.clear());
  setupTouchControls();
  $("aiCards").innerHTML = Object.entries(ai.AI_LEVELS).map(([level, info]) => `<article class="ai-card"><span>${level.toUpperCase()}</span><b>${escapeHtml(info.name)}</b><p>${escapeHtml(info.description)}</p></article>`).join("");
  renderBattleResults();
  render();
}

async function startVisibleRace(nextMode) {
  stopVisibleRace("");
  const generation = loopGeneration;
  mode = nextMode;
  state = engine.initialState({ seed: trackSeed });
  if (nextMode === "custom") {
    try {
      validateCustomCode($("editor").value);
      activeCustomSession = new CustomAISession($("editor").value);
    } catch (error) {
      mode = "idle";
      setCodeMessage(error.message, "error");
      return;
    }
  }
  $("resultModal").hidden = true;
  $("raceStatus").textContent = nextMode === "manual" ? "15 TPS 세션 시작 · 키보드나 터치 버튼으로 주행하세요." : nextMode === "custom" ? "내 AI가 매 틱 도로 센서를 읽고 있습니다." : "V3 커브 브레이커와 선택한 라이벌의 관전 경기입니다.";
  render();

  while (generation === loopGeneration && mode === nextMode && !engine.outcome(state)) {
    const started = performance.now();
    try {
      const actions = await visibleActions(nextMode);
      if (generation !== loopGeneration || mode !== nextMode) return;
      state = engine.applyActions(state, actions);
      render();
    } catch (error) {
      if (generation !== loopGeneration) return;
      const loser = nextMode === "custom" ? "P1" : null;
      state = engine.cloneState(state);
      state.winner = loser ? "P2" : null;
      state.reason = loser ? `사용자 AI 오류: ${error.message}` : error.message;
      break;
    }
    const remaining = 1000 / engine.TICKS_PER_SECOND - (performance.now() - started);
    if (remaining > 0) await delay(remaining);
  }
  if (generation !== loopGeneration) return;
  activeCustomSession?.terminate("경기가 종료되었습니다.");
  activeCustomSession = null;
  const end = engine.outcome(state);
  mode = "idle";
  if (end) showResult(end);
  render();
}

async function visibleActions(nextMode) {
  const rivalLevel = $("opponentSelect").value;
  if (nextMode === "manual") return { P1: manualAction(), P2: ai.chooseAction(state, rivalLevel, "P2").action };
  if (nextMode === "watch") return { P1: ai.chooseAction(state, "v3", "P1").action, P2: ai.chooseAction(state, rivalLevel, "P2").action };
  const legal = engine.legalActions(state);
  const custom = await activeCustomSession.choose(engine.publicState(state, "P1"), "P1", legal);
  return { P1: custom.action, P2: ai.chooseAction(state, rivalLevel, "P2").action };
}

function stopVisibleRace(message) {
  loopGeneration += 1;
  mode = "idle";
  held.clear();
  activeCustomSession?.terminate();
  activeCustomSession = null;
  if (message) $("raceStatus").textContent = message;
  render();
}

function newTrack() {
  stopVisibleRace("");
  trackSeed = Math.floor(Date.now() % 1_000_000_000);
  state = engine.initialState({ seed: trackSeed });
  $("raceStatus").textContent = `새 트랙 생성 · seed ${trackSeed}`;
  render();
}

function manualAction() {
  const throttle = held.has("accelerate") ? 1 : held.has("brake") ? -1 : 0;
  const steering = held.has("left") && !held.has("right") ? -1 : held.has("right") && !held.has("left") ? 1 : 0;
  return engine.legalActions(state).find((action) => action.throttle === throttle && action.steering === steering);
}

function handleKey(event) {
  const controls = { ArrowUp: "accelerate", w: "accelerate", W: "accelerate", ArrowDown: "brake", s: "brake", S: "brake", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
  const control = controls[event.key];
  if (!control || mode !== "manual") return;
  event.preventDefault();
  if (event.type === "keydown") held.add(control); else held.delete(control);
  syncTouchButtons();
}

function setupTouchControls() {
  for (const button of document.querySelectorAll("[data-control]")) {
    const control = button.dataset.control;
    const press = (event) => { event.preventDefault(); if (mode === "manual") held.add(control); syncTouchButtons(); };
    const release = (event) => { event.preventDefault(); held.delete(control); syncTouchButtons(); };
    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
  }
}

function syncTouchButtons() {
  for (const button of document.querySelectorAll("[data-control]")) button.classList.toggle("active", held.has(button.dataset.control));
}

async function testCode() {
  let session;
  setCodeMessage("첫 틱 행동을 검증 중입니다…");
  try {
    validateCustomCode($("editor").value);
    const testState = engine.initialState({ seed: 101 });
    const legal = engine.legalActions(testState);
    session = new CustomAISession($("editor").value);
    const choice = await session.choose(engine.publicState(testState, "P1"), "P1", legal);
    setCodeMessage(`통과 · ${engine.actionText(choice.action)} · ${choice.elapsedMs}ms`, "ok");
  } catch (error) {
    setCodeMessage(error.message, "error");
  } finally {
    session?.terminate("검증 완료");
  }
}

async function startBattle() {
  try { validateCustomCode($("editor").value); } catch (error) { return setCodeMessage(error.message, "error"); }
  stopVisibleRace("");
  battleStopRequested = false;
  battleRecords = [];
  $("runBattle").disabled = true;
  $("stopBattle").disabled = false;
  const selected = $("battleOpponent").value;
  const opponents = selected === "all" ? Object.keys(ai.AI_LEVELS) : [selected];
  const count = Number($("battleCount").value);
  const jobs = [];
  let sequence = 1;
  for (const opponent of opponents) {
    for (let index = 0; index < count; index += 1) {
      jobs.push({ sequence, opponent, customSide: index % 2 === 0 ? "P1" : "P2", seed: 5100 + Object.keys(ai.AI_LEVELS).indexOf(opponent) * 100 + Math.floor(index / 2) });
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
  activeCustomSession = null;
  setCodeMessage(battleStopRequested ? "자동 대전을 중지했습니다." : `${battleRecords.length}경기 완료`, battleStopRequested ? "" : "ok");
}

async function playCustomMatch(job) {
  let match = engine.initialState({ seed: job.seed });
  const frames = [engine.cloneState(match)];
  let error = null;
  let customElapsedTotal = 0;
  let customDecisions = 0;
  const session = new CustomAISession($("editor").value);
  activeCustomSession = session;
  try {
    while (!engine.outcome(match) && !battleStopRequested) {
      const legal = engine.legalActions(match);
      const customChoice = await session.choose(engine.publicState(match, job.customSide), job.customSide, legal);
      customElapsedTotal += customChoice.elapsedMs;
      customDecisions += 1;
      const rivalSide = job.customSide === "P1" ? "P2" : "P1";
      const actions = {
        [job.customSide]: customChoice.action,
        [rivalSide]: ai.chooseAction(match, job.opponent, rivalSide).action,
      };
      match = engine.applyActions(match, actions);
      if (match.tick % 5 === 0 || engine.outcome(match)) frames.push(engine.cloneState(match));
      if (match.tick % 60 === 0) await delay(0);
    }
  } catch (caught) {
    if (!battleStopRequested) {
      error = caught.message;
      match = engine.cloneState(match);
      match.winner = job.customSide === "P1" ? "P2" : "P1";
      match.reason = `사용자 AI 오류: ${error}`;
      frames.push(engine.cloneState(match));
    }
  } finally {
    session.terminate("경기 종료");
    if (activeCustomSession === session) activeCustomSession = null;
  }
  const end = engine.outcome(match) ?? { winner: null, reason: "사용자 요청으로 중지" };
  const result = error ? "error" : !end.winner ? "draw" : end.winner === job.customSide ? "win" : "loss";
  return {
    frames,
    log: {
      gameId: match.gameId,
      rulesVersion: match.rulesVersion,
      sequence: job.sequence,
      seed: job.seed,
      opponent: job.opponent,
      opponentName: ai.AI_LEVELS[job.opponent].name,
      customSide: job.customSide,
      result,
      winner: end.winner,
      reason: end.reason,
      ticks: match.tick,
      seconds: match.tick / engine.TICKS_PER_SECOND,
      customAverageMs: customDecisions ? Math.round(customElapsedTotal / customDecisions * 100) / 100 : 0,
      cars: engine.cloneState(match.cars),
      error,
    },
  };
}

function stopBattle() {
  battleStopRequested = true;
  activeCustomSession?.terminate();
  activeCustomSession = null;
  $("stopBattle").disabled = true;
}

function renderBattleResults() {
  const totals = { win: 0, draw: 0, loss: 0, error: 0 };
  for (const record of battleRecords) totals[record.log.result] += 1;
  $("wins").textContent = totals.win;
  $("draws").textContent = totals.draw;
  $("losses").textContent = totals.loss;
  $("errors").textContent = totals.error;
  $("battleLogs").innerHTML = battleRecords.length ? battleRecords.map((record, index) => `<div class="battle-log-row"><span>#${record.log.sequence} · ${escapeHtml(record.log.opponentName)} · <b class="battle-result ${record.log.result}">${record.log.result.toUpperCase()}</b> · ${record.log.customSide} · seed ${record.log.seed} · ${engine.formatTime(record.log.ticks)}</span><button data-replay="${index}">리플레이</button><button data-log="${index}">JSON</button></div>`).join("") : "<p>완료된 경기의 결과·리플레이·JSON 로그가 표시됩니다.</p>";
  for (const button of $("battleLogs").querySelectorAll("[data-replay]")) button.onclick = () => openReplay(Number(button.dataset.replay));
  for (const button of $("battleLogs").querySelectorAll("[data-log]")) button.onclick = () => downloadLog(Number(button.dataset.log));
}

function updateBattleProgress(done, total) {
  $("battleProgressText").textContent = `${done} / ${total}`;
  $("battleProgressBar").style.width = `${total ? done / total * 100 : 0}%`;
}

function openReplay(index) {
  replayRecord = battleRecords[index];
  $("replayTitle").textContent = `#${replayRecord.log.sequence} · ${replayRecord.log.opponentName} · ${replayRecord.log.result.toUpperCase()}`;
  $("replayRange").max = Math.max(0, replayRecord.frames.length - 1);
  $("replayRange").value = 0;
  $("replayModal").hidden = false;
  showReplayFrame(0);
}

function showReplayFrame(index) {
  if (!replayRecord) return;
  const safeIndex = Math.max(0, Math.min(index, replayRecord.frames.length - 1));
  $("replayRange").value = safeIndex;
  $("replayCounter").textContent = `${safeIndex + 1} / ${replayRecord.frames.length}`;
  drawRace($("replayCanvas").getContext("2d"), replayRecord.frames[safeIndex], $("replayCanvas"));
}

function toggleReplay() {
  if (replayTimer) {
    clearInterval(replayTimer);
    replayTimer = null;
    $("replayToggle").textContent = "재생";
    return;
  }
  $("replayToggle").textContent = "일시정지";
  replayTimer = setInterval(() => {
    const next = Number($("replayRange").value) + 1;
    if (!replayRecord || next >= replayRecord.frames.length) return toggleReplay();
    showReplayFrame(next);
  }, 100);
}

function closeReplay() {
  if (replayTimer) clearInterval(replayTimer);
  replayTimer = null;
  replayRecord = null;
  $("replayToggle").textContent = "재생";
  $("replayModal").hidden = true;
}

function downloadLog(index) {
  const log = battleRecords[index].log;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([`${JSON.stringify(log, null, 2)}\n`], { type: "application/json;charset=utf-8" }));
  link.download = `vector-racing-${log.seed}-${log.sequence}-${log.result}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function render() {
  drawRace(context, state, canvas);
  const view = engine.publicState(state, "P1");
  $("tickChip").textContent = `TICK ${String(state.tick).padStart(4, "0")} · ${engine.formatTime(state.tick)}`;
  renderDriver("p1", view.cars.P1, state);
  renderDriver("p2", view.cars.P2, state);
  $("surfaceBadge").textContent = view.road.surface.toUpperCase();
  $("surfaceBadge").style.color = view.road.surface === "asphalt" ? "var(--mint)" : "var(--coral)";
  $("sensorBars").innerHTML = view.road.lookahead.map((sample) => {
    const amount = Math.min(1, Math.abs(sample.curvature) * 75);
    const color = sample.curvature < 0 ? "var(--mint)" : "var(--amber)";
    return `<i class="sensor-bar" data-distance="${sample.distance}" title="${sample.distance}m · 곡률 ${sample.curvature}" style="height:${8 + amount * 62}px;background:${color}"></i>`;
  }).join("");
  $("edgeReadout").textContent = `LEFT ${view.road.edgeDistance.left.toFixed(1)}m · RIGHT ${view.road.edgeDistance.right.toFixed(1)}m`;
}

function renderDriver(prefix, car, raceState) {
  $(`${prefix}Speed`).textContent = Math.round(car.speedKph);
  $(`${prefix}Lap`).textContent = `LAP ${Math.min(raceState.lapsToWin, car.lap + 1)} / ${raceState.lapsToWin}`;
  $(`${prefix}Progress`).style.width = `${engine.progressRatio(raceState, prefix === "p1" ? "P1" : "P2") * 100}%`;
  $(`${prefix}Pose`).textContent = `중앙선 ${signed(car.lateralOffset)}m · 헤딩 ${signed(car.headingError * 180 / Math.PI)}° · 이탈 ${car.incidents}`;
}

function drawRace(ctx, raceState, targetCanvas) {
  const track = engine.trackGeometry(raceState.seed);
  ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  const background = ctx.createRadialGradient(400, 320, 20, 400, 320, 480);
  background.addColorStop(0, "#123229");
  background.addColorStop(1, "#071217");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  drawTrackLine(ctx, track.points, 64, "#31444a");
  drawTrackLine(ctx, track.points, 52, "#14242b");
  ctx.setLineDash([10, 14]);
  drawTrackLine(ctx, track.points, 1.5, "#8da0a35a");
  ctx.setLineDash([]);
  drawStartLine(ctx, track);
  drawCar(ctx, engine.publicState(raceState, "P1").cars.P1, "#55f2c3", "P1");
  drawCar(ctx, engine.publicState(raceState, "P2").cars.P2, "#ff6159", "P2");
}

function drawTrackLine(ctx, points, width, color) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
  ctx.closePath();
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawStartLine(ctx, track) {
  const point = engine.sampleTrack(track, 0);
  const nx = -Math.sin(point.heading);
  const ny = Math.cos(point.heading);
  ctx.save();
  ctx.strokeStyle = "#eff9f8";
  ctx.lineWidth = 4;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(point.x - nx * 25, point.y - ny * 25);
  ctx.lineTo(point.x + nx * 25, point.y + ny * 25);
  ctx.stroke();
  ctx.restore();
}

function drawCar(ctx, car, color, label) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.heading);
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.fillStyle = color;
  ctx.fillRect(-10, -6, 20, 12);
  ctx.fillStyle = "#071016";
  ctx.fillRect(1, -4, 5, 8);
  ctx.restore();
  ctx.fillStyle = color;
  ctx.font = "500 9px DM Mono, monospace";
  ctx.fillText(label, car.x + 10, car.y - 10);
}

function showResult(end) {
  $("resultTitle").textContent = end.winner ? `${end.winner} WIN` : "DRAW";
  $("resultReason").textContent = end.reason;
  $("raceStatus").textContent = end.reason;
  $("resultModal").hidden = false;
}

function resetCode() {
  $("editor").value = STARTER_AI_CODE;
  storeCode(STARTER_AI_CODE);
  setCodeMessage("예제 AI를 복원했습니다.", "ok");
}

async function loadCodeFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!/\.(js|txt)$/i.test(file.name)) return setCodeMessage(".js 또는 .txt 파일을 선택하세요.", "error");
  if (file.size > CUSTOM_AI_LIMITS.codeBytes) return setCodeMessage("AI 파일은 50KB 이하여야 합니다.", "error");
  try {
    const code = await file.text();
    validateCustomCode(code);
    $("editor").value = code;
    storeCode(code);
    setCodeMessage(`${file.name} 파일을 불러왔습니다.`, "ok");
  } catch (error) {
    setCodeMessage(error.message || "AI 파일을 읽지 못했습니다.", "error");
  }
}

function loadStrongCode() {
  const code = globalThis.VectorRacingStrongAICode;
  if (!code) return setCodeMessage("강한 AI 코드를 불러올 수 없습니다.", "error");
  $("editor").value = code;
  storeCode(code);
  setCodeMessage("V5 상대 16전 전승 AI를 불러왔습니다.", "ok");
}

async function copySpec() {
  try { await navigator.clipboard.writeText(SPEC); setCodeMessage("프롬프트를 복사했습니다.", "ok"); }
  catch { setCodeMessage("클립보드 복사에 실패했습니다.", "error"); }
}

function setCodeMessage(text, type = "") { $("codeMessage").textContent = text; $("codeMessage").className = `code-message ${type}`; }
function loadCode() { try { return localStorage.getItem("vector-racing-ai"); } catch { return null; } }
function storeCode(code) { try { localStorage.setItem("vector-racing-ai", code); } catch { /* unavailable */ } }
function signed(value) { const rounded = Math.round(value * 10) / 10; return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(1)}`; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
