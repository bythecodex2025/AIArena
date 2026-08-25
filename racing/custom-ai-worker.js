let chooseAction = null;

self.onmessage = ({ data }) => {
  try {
    if (data.type === "init") {
      blockExternalAPIs();
      const factory = new Function(
        `"use strict";\n${data.code}\n` +
        `if (typeof chooseAction !== "function") throw new Error("chooseAction(state, me) 함수를 찾을 수 없습니다.");\n` +
        `return chooseAction;`,
      );
      chooseAction = factory();
      self.postMessage({ type: "ready" });
      return;
    }
    if (data.type !== "choose" || !chooseAction) throw new Error("AI Worker가 초기화되지 않았습니다.");
    deepFreeze(data.state);
    const action = chooseAction(data.state, data.me);
    if (action && typeof action.then === "function") throw new Error("chooseAction은 Promise를 반환할 수 없습니다.");
    self.postMessage({ type: "choice", requestId: data.requestId, action });
  } catch (error) {
    self.postMessage({ type: "error", requestId: data.requestId, error: error?.message || String(error) });
  }
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function blockExternalAPIs() {
  const blocked = ["fetch", "WebSocket", "EventSource", "XMLHttpRequest", "importScripts", "indexedDB", "caches", "BroadcastChannel", "SharedWorker"];
  for (const key of blocked) {
    try { Object.defineProperty(self, key, { value: undefined, configurable: false, writable: false }); } catch { /* unavailable */ }
  }
}
