import { chooseAction, AI_LEVELS } from "./ai.js";
import { applyAction, initialState, node, outcome } from "./engine.js";

const levels = process.argv.includes("--quick") ? ["v2", "v3"] : ["v2", "v3", "v4", "v5"];
const p2EnergyArgument = process.argv.find((argument) => argument.startsWith("--p2-energy="));
const p2StartingEnergy = p2EnergyArgument ? Number(p2EnergyArgument.split("=")[1]) : null;
const centralStart = process.argv.includes("--central-start");
const rows = [];

for (const p1 of levels) {
  for (const p2 of levels) {
    let state = initialState();
    if (Number.isFinite(p2StartingEnergy)) state.energy.P2 = p2StartingEnergy;
    if (centralStart) {
      state.nodes.push(node("P1-n3", "P1", 17), node("P2-n3", "P2", 7));
      state.nextNodeIds = { P1: 4, P2: 4 };
    }
    const opening = [];
    while (!outcome(state)) {
      const level = state.currentPlayer === "P1" ? p1 : p2;
      const result = chooseAction(state, level, { timeMs: 120, maxDepth: 5 });
      if (opening.length < 8) opening.push(`${state.currentPlayer}:${result.action.id}`);
      state = applyAction(state, result.action);
    }
    const end = outcome(state);
    rows.push({
      P1: AI_LEVELS[p1].name,
      P2: AI_LEVELS[p2].name,
      winner: end.winner ?? "DRAW",
      plies: state.ply,
      opening: opening.join(" → "),
      reason: end.reason,
    });
  }
}

console.table(rows);
const p1Wins = rows.filter((row) => row.winner === "P1").length;
const p2Wins = rows.filter((row) => row.winner === "P2").length;
const draws = rows.filter((row) => row.winner === "DRAW").length;
console.log(`P1 ${p1Wins} · P2 ${p2Wins} · DRAW ${draws}`);
