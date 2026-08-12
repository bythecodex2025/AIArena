import { chooseMove as runAI, installTablebase } from "../ai.js";

/**
 * v5: 생성한 테이블베이스가 있으면 완전해를 사용하고, 없으면 반복 심화로 폴백.
 * JSON의 entries를 installTablebase(tablebase.entries)로 한 번 등록한다.
 */
export { installTablebase };
export function chooseMove(state, options) {
  return runAI(state, "v5", options).move;
}
