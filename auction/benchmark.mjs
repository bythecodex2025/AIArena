import { AI_LEVELS, chooseAction } from "./ai.js";
import { applyAction, initialState, outcome, scoreBreakdown } from "./engine.js";

const quick = process.argv.includes("--quick");
const bonusArgument = process.argv.find((item) => item.startsWith("--p1-bonus="));
const p1Bonus = bonusArgument ? Number(bonusArgument.split("=")[1]) : 0;
const levels = quick ? ["v2", "v3"] : ["v2", "v3", "v4", "v5"];
const seeds = quick ? [20260813] : [20260813, 314159, 90210];
const rows = [];

for (const seed of seeds) {
  for (const p1 of levels) {
    for (const p2 of levels) {
      let state = initialState({ seed });
      state.credits.P1 += p1Bonus;
      while (!outcome(state)) {
        const level = state.currentPlayer === "P1" ? p1 : p2;
        const choice = chooseAction(state, level, { timeMs: 70, maxDepth: 5 });
        state = applyAction(state, choice.action);
      }
      const end = outcome(state);
      const scores = scoreBreakdown(state);
      rows.push({
        seed,
        P1: AI_LEVELS[p1].name,
        P2: AI_LEVELS[p2].name,
        winner: end.winner ?? "DRAW",
        plies: state.ply,
        score: `${scores.P1.total}:${scores.P2.total}`,
        patrons: `${state.patrons.P1}/${state.patrons.P2}`,
      });
    }
  }
}

console.table(rows);
const p1Wins = rows.filter((row) => row.winner === "P1").length;
const p2Wins = rows.filter((row) => row.winner === "P2").length;
const draws = rows.filter((row) => row.winner === "DRAW").length;
const average = Math.round(rows.reduce((sum, row) => sum + row.plies, 0) / rows.length * 10) / 10;
console.log(`P1 ${p1Wins} · P2 ${p2Wins} · DRAW ${draws} · 평균 ${average}행동`);
