/* V9: deterministic root Monte Carlo with bounded diverse rollouts. */
const v9OpeningMode={P1:"balanced",P2:"balanced"};
function v9RolloutPolicy(s,root,mode,variant,ply){
 const max=s.currentPlayer===root,ranked=strongCandidates(s,6).map(a=>({a,v:v6Evaluate(applyAction(s,a),root,mode)})).sort((a,b)=>(max?b.v-a.v:a.v-b.v)||a.a.id.localeCompare(b.a.id));
 return ranked[Math.min(ranked.length-1,(variant+ply)%5===0?1:0)].a;
}
function v9MonteCarlo(s,root,mode,variant){let n=s;for(let ply=0;ply<12&&!outcome(n);ply++)n=applyAction(n,v9RolloutPolicy(n,root,mode,variant,ply));return v6Evaluate(n,root,mode)}
function chooseStrongActionV9(s,me=s.currentPlayer){
 if((me==="P1"&&s.turn<=1)||(me==="P2"&&s.turn<=2))v9OpeningMode[me]=v3ModeForOpening(s,me);const mode=v9OpeningMode[me],baseline=chooseStrongActionV8(s,me),roots=[baseline,...strongCandidates(s,10)].filter((a,i,x)=>x.findIndex(b=>b.id===a.id)===i);let chosen=baseline,best=-Infinity;
 for(const action of roots){const next=applyAction(s,action),end=outcome(next);if(end?.winner===me)return action;const values=[];for(let variant=0;variant<5;variant++)values.push(v9MonteCarlo(next,me,mode,variant));const score=values.reduce((a,b)=>a+b,0)/values.length*.65+Math.min(...values)*.35;if(score>best||(score===best&&action.id<chosen.id)){best=score;chosen=action}}
 return chosen;
}
