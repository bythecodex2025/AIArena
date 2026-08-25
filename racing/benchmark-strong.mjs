import { readFile } from "node:fs/promises";
import { applyActions, initialState, outcome, publicState } from "./engine.js";
import { chooseAction as chooseBuiltIn } from "./ai.js";

const source = await readFile(new URL("./strong-ai.js", import.meta.url), "utf8");
const chooseStrong = new Function(`${source}\nreturn chooseAction;`)();
const seeds = [11, 42, 101, 5100, 5200, 5300, 20260824, 87654321];
const results = [];

for (const seed of seeds) {
  for (const strongSide of ["P1", "P2"]) {
    const v5Side = strongSide === "P1" ? "P2" : "P1";
    let state = initialState({ seed });
    while (!outcome(state)) {
      state = applyActions(state, {
        [strongSide]: chooseStrong(publicState(state, strongSide), strongSide),
        [v5Side]: chooseBuiltIn(state, "v5", v5Side).action,
      });
    }
    results.push({ seed, strongSide, winner: state.winner, ticks: state.tick, strong: state.cars[strongSide].totalProgress, v5: state.cars[v5Side].totalProgress });
  }
}

const wins = results.filter((result) => result.winner === result.strongSide).length;
for (const result of results) console.log(`${result.seed} ${result.strongSide}: ${result.winner} · ${result.ticks} ticks · strong ${result.strong.toFixed(0)}m / V5 ${result.v5.toFixed(0)}m`);
console.log(`Strong AI: ${wins}/${results.length} wins`);
