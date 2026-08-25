import { legalActions, publicState } from "./engine.js";

export const CUSTOM_AI_LIMITS = Object.freeze({
  codeBytes: 50_000,
  actionTimeMs: 500,
  maxPlies: 48,
});

export const STARTER_AI_CODE = `function chooseAction(state, me) {
  const actions = state.legalActions;

  const win = actions.find((action) => action.type === "hack");
  if (win) return win;

  const swap = actions.find((action) => action.type === "swap");
  if (swap) return swap;

  const overload = actions.find((action) => action.type === "overload");
  if (overload) return overload;

  const takeRelay = actions.find((action) => action.type === "extend" &&
    state.relays.some((relay) => {
      const rowDistance = Math.abs(Math.floor(action.to / 5) - Math.floor(relay.position / 5));
      const columnDistance = Math.abs(action.to % 5 - relay.position % 5);
      return rowDistance + columnDistance === 1;
    }));
  if (takeRelay) return takeRelay;

  return actions.find((action) => action.type === "extend")
    || actions.find((action) => action.type === "wait")
    || actions.find((action) => action.type === "settle");
}`;

export const CUSTOM_AI_SPEC = `[Relay Forge AI 작성 규격]

전역 함수 chooseAction(state, me)를 작성하세요.

- me: "P1" 또는 "P2"
- state.gameId: "relay-forge"
- state.boardWidth / boardHeight: 5 / 5
- state.ply / maxPlies: 현재 반수 / 최대 48반수
- state.energy: { P1, P2 }, 각 0~4
- state.signalScores: 보유 중계기로 누적한 신호 점수
- state.cores: { id, owner, position } 배열
- state.nodes: { id, owner, position, fortified, powered } 배열
- state.relays: { position, owner, influence } 배열, 위치는 5·12·19
- state.lastActions: 직전 행동 설명
- state.legalActions: 현재 반환 가능한 모든 합법 행동

행동:
{ id:"extend:17", type:"extend", to:17, cost:1 }
{ id:"overload:P2-n7", type:"overload", targetId:"P2-n7", cost:2 }
{ id:"fortify:P1-n4", type:"fortify", nodeId:"P1-n4", cost:2 }
{ id:"hack:P2-core", type:"hack", targetId:"P2-core", cost:3 }
{ id:"swap", type:"swap", cost:0 }
{ id:"wait", type:"wait", cost:0 }
{ id:"settle", type:"settle", cost:0 }

승리:
- 상대 코어 인접 전력 노드가 있을 때 에너지 3으로 해킹
- 자기 행동 뒤 보유 중계기 수만큼 신호 점수를 얻고, P2 응답 뒤 먼저 5점이면 승리
- 같은 라운드에 양쪽이 5점 동점이면 무승부

중앙 중계기 특칙:
- 중계기 위치는 5·12·19이며 노드를 직접 놓을 수 없는 중립 시설입니다.
- 중계기 주변의 활성 노드 수가 더 많은 플레이어가 그 중계기를 점령합니다.
- 점령에는 최소 2개의 인접 활성 노드가 필요합니다.
- 양측 활성 노드 수가 같으면 경합 상태가 되어 어느 쪽도 점령하지 않습니다.

첫 수 교환 규칙:
- P1의 첫 행동 직후 P2의 legalActions에는 swap이 한 번 제공됩니다.
- swap을 선택하면 보드를 180도 돌리고 진영을 교환해 P2가 첫 행동 결과를 넘겨받습니다.
- 첫 수가 지나치게 유리하다고 판단할 때 사용합니다.

반복 방지 규칙:
- 과거에 나온 보드·에너지·연속 점령·차례의 조합을 그대로 만드는 행동은 legalActions에서 제외됩니다.
- 새로운 상태를 만드는 행동이 하나도 없으면 settle만 제공되며 현재 우위 기준으로 즉시 정산합니다.

제약:
- state를 수정하지 마세요.
- legalActions의 객체, 행동 ID 문자열 또는 같은 id의 객체를 동기적으로 반환하세요.
- 한 행동 500ms, 코드 50KB 제한입니다.
- 네트워크, 저장소, DOM API는 사용할 수 없습니다.

[예제]
${STARTER_AI_CODE}`;

const activeWorkers = new Map();

export function validateCustomCode(code) {
  if (typeof code !== "string" || !code.trim()) throw new Error("AI 코드를 입력하세요.");
  if (new TextEncoder().encode(code).length > CUSTOM_AI_LIMITS.codeBytes) throw new Error("AI 코드는 50KB 이하여야 합니다.");
  if (!/\bfunction\s+chooseAction\s*\(|\b(?:const|let|var)\s+chooseAction\s*=/.test(code)) {
    throw new Error("chooseAction(state, me) 함수를 찾을 수 없습니다.");
  }
  return true;
}

export function validateCustomFileMetadata(file) {
  if (!file?.name) throw new Error("불러올 AI 파일을 선택하세요.");
  if (!/\.(?:js|txt)$/i.test(file.name)) throw new Error(".js 또는 .txt 파일만 불러올 수 있습니다.");
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error("선택한 파일이 비어 있습니다.");
  if (file.size > CUSTOM_AI_LIMITS.codeBytes) throw new Error("AI 파일은 50KB 이하여야 합니다.");
  return true;
}

export function findLegalCustomAction(state, requested) {
  const id = typeof requested === "string" ? requested : requested?.id;
  return legalActions(state).find((action) => action.id === id) ?? null;
}

export function makePublicState(state) {
  return publicState(state);
}

export function runCustomAI(code, state, options = {}) {
  validateCustomCode(code);
  const timeoutMs = Math.max(20, Math.min(options.timeoutMs ?? CUSTOM_AI_LIMITS.actionTimeMs, 2_000));
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const worker = new Worker(new URL("./custom-ai-worker.js", import.meta.url));
  const started = performance.now();

  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      activeWorkers.delete(worker);
      worker.terminate();
    };
    activeWorkers.set(worker, (reason = "사용자 AI 실행을 중지했습니다.") => {
      finish();
      reject(new Error(reason));
    });
    const timer = setTimeout(() => {
      finish();
      reject(new Error(`시간 초과: 한 행동에 ${timeoutMs}ms를 넘겼습니다.`));
    }, timeoutMs);
    worker.onmessage = ({ data }) => {
      if (data?.requestId !== requestId) return;
      finish();
      if (!data.ok) return reject(new Error(data.error || "사용자 AI 실행 중 오류가 발생했습니다."));
      const action = findLegalCustomAction(state, data.action);
      if (!action) return reject(new Error("state.legalActions에 없는 행동을 반환했습니다."));
      resolve({
        action,
        stats: {
          level: "custom",
          nodes: 0,
          depth: "—",
          score: 0,
          source: "custom-code",
          elapsedMs: Math.round((performance.now() - started) * 10) / 10,
        },
      });
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "사용자 AI Worker 오류"));
    };
    worker.postMessage({ requestId, code, state: makePublicState(state), me: state.currentPlayer });
  });
}

export function terminateCustomAIWorkers() {
  for (const cancel of [...activeWorkers.values()]) cancel();
  activeWorkers.clear();
}
