import { chooseMove as runAI } from "../ai.js";

/** v3: 3수 미니맥스 */
export function chooseMove(state, options) {
  return runAI(state, "v3", options).move;
}
