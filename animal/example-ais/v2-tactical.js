import { chooseMove as runAI } from "../ai.js";

/** v2: 한 수 뒤의 포획·트라이·기물 이득 평가 */
export function chooseMove(state, options) {
  return runAI(state, "v2", options).move;
}
