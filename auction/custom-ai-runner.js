import { MAX_PLIES, legalActions, publicState } from "./engine.js";

export const CUSTOM_AI_LIMITS = Object.freeze({ codeBytes: 50_000, actionTimeMs: 500, maxPlies: MAX_PLIES });

export const STARTER_AI_CODE = `function chooseAction(state, me) {
  const actions = state.legalActions;

  if (state.phase === "patron") {
    return actions.find((action) => action.patronId === "curator");
  }

  const lot = state.currentLot;
  const affordable = actions
    .filter((action) => action.type === "bid" && !action.useFavor)
    .sort((a, b) => b.offer - a.offer);

  if (state.leader && state.leader !== me && state.highBid >= lot.value + 2) {
    return actions.find((action) => action.type === "pass");
  }

  return affordable.find((action) => action.offer <= lot.value + 1)
    || actions.find((action) => action.type === "pass");
}`;

export const CUSTOM_AI_SPEC = `[Starlight Auction AI 작성 규격]

전역 함수 chooseAction(state, me)를 작성하세요.

- me: "P1" 또는 "P2"
- state.gameId: "starlight-auction"
- state.phase: "patron" 또는 "auction"
- state.ply / maxPlies: 현재 행동 수 / 최대 96
- state.seed: 재현 가능한 유물 순서 시드
- state.credits / favor: 양측 자금과 영향력 토큰
- state.patrons: 양측 후원자 ID
- state.collections: 양측이 낙찰받은 공개 유물 배열
- state.currentLot / nextLot: 현재 유물과 다음 유물 미리보기
- state.highBid / leader / leaderCost: 현재 제시가, 선두, 실제 지불 예정액
- state.scores: 현재 점수 세부 내역
- state.legalActions: 현재 반환 가능한 합법 행동

후원자:
- curator: 3종 세트당 7점
- critic: 분야별 단독 다수당 5점
- broker: 남은 크레딧 5개마다 2점

입찰 행동:
{ id:"bid:4", type:"bid", offer:4, payment:4, useFavor:false }
{ id:"favor:5", type:"bid", offer:5, payment:4, useFavor:true }
{ id:"pass", type:"pass" }

규칙:
- 일반 입찰은 현재가보다 1~3 높은 가격을 제시합니다.
- 영향력 입찰은 토큰 1개를 쓰고 제시가보다 1 적게 지불합니다.
- 선두가 있을 때 상대가 패스하면 선두가 낙찰받습니다.
- 아무도 입찰하지 않고 두 번 패스하면 유찰됩니다.
- 8개 경매 후 기본 가치 + 3종 세트 + 분야별 다수 + 잔여 자금으로 승부합니다.
- 환급 유물은 낙찰 즉시 크레딧 +2, 영향력 유물은 토큰 +1입니다.

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
    const finish = () => { clearTimeout(timer); activeWorkers.delete(worker); worker.terminate(); };
    activeWorkers.set(worker, (reason = "사용자 AI 실행을 중지했습니다.") => { finish(); reject(new Error(reason)); });
    const timer = setTimeout(() => { finish(); reject(new Error(`시간 초과: 한 행동에 ${timeoutMs}ms를 넘겼습니다.`)); }, timeoutMs);
    worker.onmessage = ({ data }) => {
      if (data?.requestId !== requestId) return;
      finish();
      if (!data.ok) return reject(new Error(data.error || "사용자 AI 실행 중 오류가 발생했습니다."));
      const action = findLegalCustomAction(state, data.action);
      if (!action) return reject(new Error("state.legalActions에 없는 행동을 반환했습니다."));
      resolve({ action, stats: { level: "custom", nodes: 0, depth: "—", score: 0, source: "custom-code", elapsedMs: Math.round((performance.now() - started) * 10) / 10 } });
    };
    worker.onerror = (event) => { finish(); reject(new Error(event.message || "사용자 AI Worker 오류")); };
    worker.postMessage({ requestId, code, state: makePublicState(state), me: state.currentPlayer });
  });
}

export function terminateCustomAIWorkers() {
  for (const cancel of [...activeWorkers.values()]) cancel();
  activeWorkers.clear();
}
