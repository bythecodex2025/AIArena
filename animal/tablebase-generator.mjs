import fs from "node:fs";
import { initialState, piece } from "./engine.js";
import { solveExhaustively } from "./exhaustive-solver.js";

const args = new Set(process.argv.slice(2));
const full = args.has("--full");
const demo = args.has("--demo");
const limitArg = process.argv.find((arg) => arg.startsWith("--max-states="));
const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
const maxStates = full ? Infinity : Number(limitArg?.split("=")[1] ?? 250_000);
const output = outputArg?.slice("--output=".length) ?? "tablebase.json";

console.log(`상태 그래프 열거 시작: 최대 ${Number.isFinite(maxStates) ? maxStates.toLocaleString() : "무제한"}개`);
const started = Date.now();
const solved = solveExhaustively(demo ? demoPosition() : initialState(), {
  maxStates,
  onProgress: ({ visited, discovered }) => {
    console.log(`  방문 ${visited.toLocaleString()} / 발견 ${discovered.toLocaleString()}`);
  },
});

if (!solved.complete) {
  console.error(solved.reason);
  console.error("전체 생성은 대용량 메모리 환경에서 `node tablebase-generator.mjs --full`로 실행하세요.");
  process.exitCode = 2;
} else {
  const payload = {
    format: "animal-shogi-tablebase-v1",
    generatedAt: new Date().toISOString(),
    stateCount: solved.stateCount,
    counts: solved.counts,
    entries: Object.fromEntries(solved.entries),
  };
  fs.writeFileSync(output, JSON.stringify(payload));
  console.log(`완료: ${solved.stateCount.toLocaleString()}개 상태, ${((Date.now() - started) / 1000).toFixed(1)}초`);
  console.log(`저장: ${output}`);
}

function demoPosition() {
  const state = initialState();
  state.board = Array(12).fill(null);
  state.board[4] = piece("P1", "lion");
  state.board[1] = piece("P2", "lion");
  return state;
}
