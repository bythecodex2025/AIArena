import { chooseMove as runAI } from "../ai.js";

/** v1: 합법 수 무작위 선택 */
export function chooseMove(state, options) {
  return runAI(state, "v1", options).move;
}
