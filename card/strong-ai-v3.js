/* V3 candidate: deterministic completed three-ply alpha-beta search. */
const v3OpeningMode={P1:"balanced",P2:"balanced"};
function v3ModeForOpening(s,me){const hand=s.hands[me];return hand.includes("meteor_shard")&&hand.includes("shield_bearer")&&!hand.includes("renewal_field")?"tower":"balanced"}
function v3Evaluate(s,me,mode){
  const end=outcome(s);if(end)return strongEvaluate(s,me);
  const enemy=foe(me),dead=p=>s.towers.filter(t=>t.owner===p&&t.hp<=0).length;
  let score=(dead(enemy)-dead(me))*30000;
  const towerMode=mode==="tower";
  for(const t of s.towers){const sign=t.owner===me?1:-1;if(t.hp>0)score+=sign*t.hp*(t.type==="core"?(towerMode?1000:850):(towerMode?650:480))}
  for(const u of aliveUnits(s)){
    const sign=u.owner===me?1:-1,targets=aliveTowers(s).filter(t=>t.owner!==u.owner);
    const d=targets.length?Math.min(...targets.map(t=>dist(u.position,t.position))):12;
    score+=sign*(u.hp*(towerMode?20:28)+u.damage*(towerMode?45:65)+u.range*(towerMode?18:24)+(u.shield||0)*(towerMode?20:30)+Math.max(0,8-d)*(towerMode?38:45));
  }
  score+=(s.energy[me]-s.energy[enemy])*18;
  return score+strongEvaluate(s,me)*(towerMode?0.08:0.15);
}
function v3Search(s,depth,alpha,beta,me,ply,mode){
  if(depth===0||outcome(s))return v3Evaluate(s,me,mode);
  const limits=[12,8,5],actions=strongCandidates(s,limits[Math.min(ply,2)]),max=s.currentPlayer===me;
  let best=max?-Infinity:Infinity;
  for(const action of actions){const value=v3Search(applyAction(s,action),depth-1,alpha,beta,me,ply+1,mode);if(max){best=Math.max(best,value);alpha=Math.max(alpha,best)}else{best=Math.min(best,value);beta=Math.min(beta,best)}if(beta<=alpha)break}
  return best;
}
function chooseStrongActionV3(s,me=s.currentPlayer){
  if((me==="P1"&&s.turn<=1)||(me==="P2"&&s.turn<=2))v3OpeningMode[me]=v3ModeForOpening(s,me);
  const mode=v3OpeningMode[me];
  const roots=strongCandidates(s,12);let chosen=roots[0],best=-Infinity;
  for(const action of roots){
    const next=applyAction(s,action),end=outcome(next);
    if(end?.winner===me)return action;
    const score=v3Search(next,2,-Infinity,Infinity,me,1,mode);
    if(score>best||(score===best&&action.id<chosen.id)){best=score;chosen=action}
  }
  return chosen;
}
