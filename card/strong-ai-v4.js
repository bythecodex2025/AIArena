/* V4 candidate: deterministic limited rollout with a fast one-ply simulation policy. */
const v4OpeningMode={P1:"balanced",P2:"balanced"};
function v4FastAction(s,root,mode){
  const max=s.currentPlayer===root;let chosen=null,best=max?-Infinity:Infinity;
  for(const action of strongCandidates(s,7)){const value=v3Evaluate(applyAction(s,action),root,mode);if(chosen===null||(max?value>best:value<best)){chosen=action;best=value}}
  return chosen
}
function v4Rollout(s,root,mode,plies=6){let n=s;for(let i=0;i<plies&&!outcome(n);i++)n=applyAction(n,v4FastAction(n,root,mode));return v3Evaluate(n,root,mode)}
function chooseStrongActionV4(s,me=s.currentPlayer){
  if((me==="P1"&&s.turn<=1)||(me==="P2"&&s.turn<=2))v4OpeningMode[me]=v3ModeForOpening(s,me);
  const mode=v4OpeningMode[me],roots=strongCandidates(s,14);let chosen=roots[0],best=-Infinity;
  for(const action of roots){const next=applyAction(s,action),end=outcome(next);if(end?.winner===me)return action;const score=v4Rollout(next,me,mode,8);if(score>best||(score===best&&action.id<chosen.id)){best=score;chosen=action}}return chosen
}
