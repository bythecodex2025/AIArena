import { AI_LEVELS, chooseMove } from "./ai.js";
import { applyMove, initialState, stateKey, withDraw } from "./engine.js";

const levels = ["v1", "v2", "v3", "v4", "v5"];
const gamesPerPair = Number(process.argv.find((arg) => arg.startsWith("--games="))?.split("=")[1] ?? 2);
const score = Object.fromEntries(levels.map((level) => [level, { win: 0, draw: 0, loss: 0, nodes: 0, moves: 0 }]));

for (let leftIndex = 0; leftIndex < levels.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < levels.length; rightIndex += 1) {
    for (let game = 0; game < gamesPerPair; game += 1) {
      const p1 = game % 2 === 0 ? levels[leftIndex] : levels[rightIndex];
      const p2 = game % 2 === 0 ? levels[rightIndex] : levels[leftIndex];
      const result = play(p1, p2);
      if (result === "DRAW") {
        score[p1].draw += 1; score[p2].draw += 1;
      } else {
        const winner = result === "P1" ? p1 : p2;
        const loser = result === "P1" ? p2 : p1;
        score[winner].win += 1; score[loser].loss += 1;
      }
    }
  }
}

console.table(levels.map((level) => ({
  AI: AI_LEVELS[level].name,
  승: score[level].win,
  무: score[level].draw,
  패: score[level].loss,
  "평균 탐색 노드": Math.round(score[level].nodes / Math.max(1, score[level].moves)),
})));

function play(p1, p2) {
  let state = initialState();
  const seen = new Map([[stateKey(state), 1]]);
  for (let ply = 0; ply < 220 && !state.winner; ply += 1) {
    const level = state.turn === "P1" ? p1 : p2;
    const answer = chooseMove(state, level, {
      timeMs: level === "v5" ? 100 : 25,
      maxDepth: level === "v5" ? 12 : 8,
    });
    score[level].nodes += answer.stats.nodes;
    score[level].moves += 1;
    state = applyMove(state, answer.move);
    if (!state.winner) {
      const key = stateKey(state);
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count >= 3) state = withDraw(state);
    }
  }
  return state.winner ?? "DRAW";
}
