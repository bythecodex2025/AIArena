/* V8 rewrite 2: widened and deepened V7 architecture. */
const v8OpeningMode={P1:"balanced",P2:"balanced"};
function v8Proposal(s,me,mode,width,plies){const roots=strongCandidates(s,width),cache=new Map();let chosen=roots[0],best=-Infinity;for(const action of roots){const next=applyAction(s,action),end=outcome(next);if(end?.winner===me)return action;const score=v6Rollout(next,me,mode,plies,cache);if(score>best||(score===best&&action.id<chosen.id)){best=score;chosen=action}}return chosen}
function v8VerifiedScore(s,action,me,mode){const next=applyAction(s,action),end=outcome(next);if(end)return v6Evaluate(next,me,mode);let worst=Infinity;for(const reply of strongCandidates(next,8)){const after=applyAction(next,reply);let best=v6Evaluate(after,me,mode);if(!outcome(after))for(const follow of strongCandidates(after,9))best=Math.max(best,v6Evaluate(applyAction(after,follow),me,mode));worst=Math.min(worst,best)}return worst}
function chooseStrongActionV8(s,me=s.currentPlayer){
 if((me==="P1"&&s.turn<=1)||(me==="P2"&&s.turn<=2))v8OpeningMode[me]=v3ModeForOpening(s,me);const mode=v8OpeningMode[me],proposals=[v8Proposal(s,me,mode,36,10),v8Proposal(s,me,mode,24,12),v8Proposal(s,me,mode,16,14),chooseStrongActionV7(s,me)].filter((a,i,x)=>x.findIndex(b=>b.id===a.id)===i);let chosen=proposals[0],best=-Infinity;
 for(const action of proposals){const next=applyAction(s,action),end=outcome(next);if(end?.winner===me)return action;const score=v8VerifiedScore(s,action,me,mode);if(score>best||(score===best&&action.id<chosen.id)){best=score;chosen=action}}return chosen
}
