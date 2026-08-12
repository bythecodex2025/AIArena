import { legalMoves, sameMove } from "./engine.js";

export const CUSTOM_AI_LIMITS = Object.freeze({
  codeBytes: 50_000,
  moveTimeMs: 500,
  maxPlies: 240,
});

export const STARTER_AI_CODE = `function chooseMove(state, me) {
  const moves = state.legalMoves;

  // 1. 상대 라이온을 바로 잡을 수 있으면 선택
  const win = moves.find((move) =>
    move.type === "move" && state.board[move.to]?.type === "lion"
  );
  if (win) return win;

  // 2. 잡는 수를 우선
  const captures = moves.filter((move) =>
    move.type === "move" && state.board[move.to] !== null
  );
  if (captures.length) return captures[0];

  // 3. 나머지는 무작위
  return moves[Math.floor(Math.random() * moves.length)];
}`;

export const CUSTOM_AI_SPEC = `[동물장기 AI 작성 규격]

전역 함수 chooseMove(state, me)를 작성하세요.

- me: "P1" 또는 "P2"
- state.board: 길이 12 배열. 빈칸은 null, 말은 { owner, type }
- type: lion, giraffe, elephant, chick, hen
- state.hands: { P1: { chick, elephant, giraffe }, P2: {...} }
- state.turn: 현재 차례
- state.ply: 현재까지 진행된 반수
- state.legalMoves: 현재 반환 가능한 모든 합법 수

반환 형식:
- 이동: { type: "move", from: 10, to: 7 }
- 말 놓기: { type: "drop", piece: "chick", to: 4 }

제약:
- state를 수정하지 마세요.
- state.legalMoves에 포함된 수 하나를 동기적으로 반환하세요.
- 한 수 제한 시간은 500ms, 코드 제한은 50KB입니다.
- 네트워크, 저장소, DOM API는 사용할 수 없습니다.`;

const activeWorkers = new Set();

export function makePublicState(state) {
  return {
    board: state.board.map((item) => item ? { ...item } : null),
    hands: {
      P1: { ...state.hands.P1 },
      P2: { ...state.hands.P2 },
    },
    turn: state.turn,
    ply: state.ply ?? 0,
    legalMoves: legalMoves(state).map((move) => ({ ...move })),
  };
}

export function findLegalCustomMove(state, requestedMove) {
  return legalMoves(state).find((move) => sameMove(move, requestedMove)) ?? null;
}

export function validateCustomCode(code) {
  if (typeof code !== "string" || !code.trim()) throw new Error("AI 코드를 입력하세요.");
  const bytes = new TextEncoder().encode(code).length;
  if (bytes > CUSTOM_AI_LIMITS.codeBytes) throw new Error("AI 코드는 50KB 이하여야 합니다.");
  if (!/\bfunction\s+chooseMove\s*\(|\b(?:const|let|var)\s+chooseMove\s*=/.test(code)) {
    throw new Error("chooseMove(state, me) 함수를 찾을 수 없습니다.");
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

export function runCustomAI(code, state, options = {}) {
  validateCustomCode(code);
  const timeoutMs = Math.max(20, Math.min(options.timeoutMs ?? CUSTOM_AI_LIMITS.moveTimeMs, 2_000));
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const worker = new Worker(new URL("./custom-ai-worker.js", import.meta.url));
  activeWorkers.add(worker);
  const started = performance.now();

  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      activeWorkers.delete(worker);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error(`시간 초과: 한 수에 ${timeoutMs}ms를 넘겼습니다.`));
    }, timeoutMs);

    worker.onmessage = ({ data }) => {
      if (data?.requestId !== requestId) return;
      finish();
      if (!data.ok) {
        reject(new Error(data.error || "사용자 AI 실행 중 오류가 발생했습니다."));
        return;
      }
      const move = findLegalCustomMove(state, data.move);
      if (!move) {
        reject(new Error("state.legalMoves에 없는 수를 반환했습니다."));
        return;
      }
      resolve({
        move,
        stats: {
          level: "custom",
          nodes: 0,
          depth: "—",
          tableHits: 0,
          exact: false,
          source: "custom-code",
          elapsedMs: Math.round((performance.now() - started) * 10) / 10,
        },
      });
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "사용자 AI Worker 오류"));
    };
    worker.postMessage({ requestId, code, state: makePublicState(state), me: state.turn });
  });
}

export function terminateCustomAIWorkers() {
  for (const worker of activeWorkers) worker.terminate();
  activeWorkers.clear();
}
