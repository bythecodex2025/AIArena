const send = self.postMessage.bind(self);

self.onmessage = ({ data }) => {
  const { requestId, code, state, me } = data;
  try {
    blockExternalAPIs();
    deepFreeze(state);
    const factory = new Function(
      `"use strict";\n${code}\n` +
      `if (typeof chooseMove !== "function") throw new Error("chooseMove(state, me) 함수를 찾을 수 없습니다.");\n` +
      `return chooseMove;`,
    );
    const chooseMove = factory();
    const move = chooseMove(state, me);
    if (move && typeof move.then === "function") throw new Error("chooseMove는 비동기 Promise를 반환할 수 없습니다.");
    send({ requestId, ok: true, move });
  } catch (error) {
    send({ requestId, ok: false, error: error?.message || String(error) });
  }
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function blockExternalAPIs() {
  const blocked = [
    "fetch", "WebSocket", "EventSource", "XMLHttpRequest", "importScripts",
    "indexedDB", "caches", "BroadcastChannel", "SharedWorker",
  ];
  for (const key of blocked) {
    try { Object.defineProperty(self, key, { value: undefined, configurable: false, writable: false }); } catch { /* unavailable */ }
  }
}

