import { chooseMove as runAI } from "../ai.js";

/** v4: 6수 알파베타 + 전치표 */
export function chooseMove(state, options) {
  return runAI(state, "v4", options).move;
}
