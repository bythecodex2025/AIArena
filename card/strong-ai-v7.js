/* V7 HP30 revision: proposal ensemble with pessimistic multi-reply verification. */
const v7OpeningMode={P1:"balanced",P2:"balanced"};
function v7Proposal(s,me,mode,width,plies){const roots=strongCandidates(s,width),cache=new Map();let chosen=roots[0],best=-Infinity;for(const action of roots){const next=applyAction(s,action),end=outcome(next);if(end?.winner===me)return action;const score=v6Rollout(next,me,mode,plies,cache);if(score>best||(score===best&&action.id<chosen.id)){best=score;chosen=action}}return chosen}
function v7VerifiedScore(s,action,me,mode){
  const next=applyAction(s,action),end=outcome(next);if(end)return v6Evaluate(next,me,mode);
  let worst=Infinity;
  for(const reply of strongCandidates(next,6)){
    const after=applyAction(next,reply);let best=v6Evaluate(after,me,mode);
    if(!outcome(after))for(const follow of strongCandidates(after,7))best=Math.max(best,v6Evaluate(applyAction(after,follow),me,mode));
    worst=Math.min(worst,best);
  }
  return worst;
}
function chooseStrongActionV7(s,me=s.currentPlayer){
  if((me==="P1"&&s.turn<=1)||(me==="P2"&&s.turn<=2))v7OpeningMode[me]=v3ModeForOpening(s,me);
  const mode=v7OpeningMode[me],proposals=[v7Proposal(s,me,mode,28,8),v7Proposal(s,me,mode,18,10),v7Proposal(s,me,mode,12,12)].filter((a,i,x)=>x.findIndex(b=>b.id===a.id)===i);
  let chosen=proposals[0],best=-Infinity;
  for(const action of proposals){const next=applyAction(s,action),end=outcome(next);if(end?.winner===me)return action;const score=v7VerifiedScore(s,action,me,mode);if(score>best||(score===best&&action.id<chosen.id)){best=score;chosen=action}}
  return chosen;
}
