export const CUSTOM_AI_LIMITS = Object.freeze({ codeBytes: 50_000, actionTimeMs: 500 });

const activeWorkers = new Map();

export function validateCustomCode(code) {
  if (typeof code !== "string" || !code.trim()) throw new Error("AI 코드를 입력하세요.");
  if (new TextEncoder().encode(code).length > CUSTOM_AI_LIMITS.codeBytes) throw new Error("AI 코드는 50KB 이하여야 합니다.");
  if (!/\bfunction\s+chooseAction\s*\(|\b(?:const|let|var)\s+chooseAction\s*=/.test(code)) throw new Error("chooseAction(state, me) 함수를 찾을 수 없습니다.");
  return true;
}

export function validateCustomFileMetadata(file) {
  if (!file?.name) throw new Error("불러올 AI 파일을 선택하세요.");
  if (!/\.(?:js|txt)$/i.test(file.name)) throw new Error(".js 또는 .txt 파일만 불러올 수 있습니다.");
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error("선택한 파일이 비어 있습니다.");
  if (file.size > CUSTOM_AI_LIMITS.codeBytes) throw new Error("AI 파일은 50KB 이하여야 합니다.");
  return true;
}

export function findLegalAction(legalActions, requested) {
  const id = typeof requested === "string" ? requested : requested?.id;
  return legalActions.find((action) => action.id === id) ?? null;
}

export function runCustomAI(code, state, legalActions, workerUrl, options = {}) {
  validateCustomCode(code);
  const timeoutMs = Math.max(20, Math.min(options.timeoutMs ?? CUSTOM_AI_LIMITS.actionTimeMs, 2_000));
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const worker = new Worker(workerUrl);
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); activeWorkers.delete(worker); worker.terminate(); };
    activeWorkers.set(worker, (reason = "사용자 AI 실행을 중지했습니다.") => { finish(); reject(new Error(reason)); });
    const timer = setTimeout(() => { finish(); reject(new Error(`시간 초과: 한 행동에 ${timeoutMs}ms를 넘겼습니다.`)); }, timeoutMs);
    worker.onmessage = ({ data }) => {
      if (data?.requestId !== requestId) return;
      finish();
      if (!data.ok) return reject(new Error(data.error || "사용자 AI 실행 중 오류가 발생했습니다."));
      const action = findLegalAction(legalActions, data.action);
      if (!action) return reject(new Error("state.legalActions에 없는 행동을 반환했습니다."));
      resolve({ action, stats: { level: "custom", nodes: 0, depth: "—", elapsedMs: Math.round((performance.now() - started) * 10) / 10 } });
    };
    worker.onerror = (event) => { finish(); reject(new Error(event.message || "사용자 AI Worker 오류")); };
    worker.postMessage({ requestId, code, state, me: state.currentPlayer });
  });
}

export function terminateCustomAIWorkers() {
  for (const cancel of [...activeWorkers.values()]) cancel();
  activeWorkers.clear();
}

export function fairSideSchedule(gameCount) {
  if (!Number.isInteger(gameCount) || gameCount < 2 || gameCount % 2 !== 0) throw new Error("경기 수는 2 이상의 짝수여야 합니다.");
  return Array.from({ length: gameCount }, (_, index) => index % 2 === 0 ? "P1" : "P2");
}
