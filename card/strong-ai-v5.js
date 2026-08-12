/* V5 candidate: longer deterministic rollout using V4's validated fast policy. */
const v5OpeningMode={P1:"balanced",P2:"balanced"};
function chooseStrongActionV5(s,me=s.currentPlayer){
  if((me==="P1"&&s.turn<=1)||(me==="P2"&&s.turn<=2))v5OpeningMode[me]=v3ModeForOpening(s,me);
  const mode=v5OpeningMode[me],roots=strongCandidates(s,24);let chosen=roots[0],best=-Infinity;
  for(const action of roots){const next=applyAction(s,action),end=outcome(next);if(end?.winner===me)return action;const score=v4Rollout(next,me,mode,8);if(score>best||(score===best&&action.id<chosen.id)){best=score;chosen=action}}return chosen
}
