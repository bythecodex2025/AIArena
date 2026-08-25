export const CUSTOM_AI_LIMITS = Object.freeze({ codeBytes: 50_000, actionTimeMs: 500 });

const CUSTOM_AI_WORKER_SOURCE = `
let chooseAction = null;
self.onmessage = ({ data }) => {
  try {
    if (data.type === "init") {
      const blocked = ["fetch", "WebSocket", "EventSource", "XMLHttpRequest", "importScripts", "indexedDB", "caches", "BroadcastChannel", "SharedWorker"];
      for (const key of blocked) {
        try { Object.defineProperty(self, key, { value: undefined, configurable: false, writable: false }); } catch {}
      }
      const factory = new Function(
        '\"use strict\";\\n' + data.code + '\\n' +
        'if (typeof chooseAction !== "function") throw new Error("chooseAction(state, me) 함수를 찾을 수 없습니다.");\\n' +
        'return chooseAction;'
      );
      chooseAction = factory();
      self.postMessage({ type: "ready" });
      return;
    }
    if (data.type !== "choose" || !chooseAction) throw new Error("AI Worker가 초기화되지 않았습니다.");
    const deepFreeze = (value) => {
      if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
      for (const child of Object.values(value)) deepFreeze(child);
      return Object.freeze(value);
    };
    deepFreeze(data.state);
    const action = chooseAction(data.state, data.me);
    if (action && typeof action.then === "function") throw new Error("chooseAction은 Promise를 반환할 수 없습니다.");
    self.postMessage({ type: "choice", requestId: data.requestId, action });
  } catch (error) {
    self.postMessage({ type: "error", requestId: data.requestId, error: error?.message || String(error) });
  }
};`;

export function validateCustomCode(code) {
  if (typeof code !== "string" || !code.trim()) throw new Error("AI 코드를 입력하세요.");
  if (new TextEncoder().encode(code).length > CUSTOM_AI_LIMITS.codeBytes) throw new Error("AI 코드는 50KB 이하여야 합니다.");
  if (!/\bfunction\s+chooseAction\s*\(|\b(?:const|let|var)\s+chooseAction\s*=/.test(code)) throw new Error("chooseAction(state, me) 함수를 찾을 수 없습니다.");
  return true;
}

export function findLegalAction(legalActions, requested) {
  const id = typeof requested === "string" ? requested : requested?.id;
  return legalActions.find((action) => action.id === id) ?? null;
}

export class CustomAISession {
  constructor(code) {
    validateCustomCode(code);
    this.workerObjectUrl = URL.createObjectURL(new Blob([CUSTOM_AI_WORKER_SOURCE], { type: "text/javascript" }));
    this.worker = new Worker(this.workerObjectUrl);
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.onmessage = ({ data }) => this.handleMessage(data);
    this.worker.onerror = (event) => this.failAll(event.message || "사용자 AI Worker 오류");
    this.worker.postMessage({ type: "init", code });
  }

  async choose(state, me, legalActions, timeoutMs = CUSTOM_AI_LIMITS.actionTimeMs) {
    await this.ready;
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const started = performance.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`시간 초과: 한 행동에 ${timeoutMs}ms를 넘겼습니다.`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, legalActions, started });
      this.worker.postMessage({ type: "choose", requestId, state, me });
    });
  }

  handleMessage(data) {
    if (data.type === "ready") return this.resolveReady();
    if (data.type === "error" && !data.requestId) return this.rejectReady(new Error(data.error));
    const pending = this.pending.get(data.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(data.requestId);
    if (data.type === "error") return pending.reject(new Error(data.error));
    const action = findLegalAction(pending.legalActions, data.action);
    if (!action) return pending.reject(new Error("state.legalActions에 없는 행동을 반환했습니다."));
    pending.resolve({ action, elapsedMs: Math.round((performance.now() - pending.started) * 10) / 10 });
  }

  failAll(message) {
    this.rejectReady?.(new Error(message));
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  terminate(reason = "사용자 AI 실행을 중지했습니다.") {
    this.failAll(reason);
    this.worker.terminate();
    URL.revokeObjectURL(this.workerObjectUrl);
  }
}
