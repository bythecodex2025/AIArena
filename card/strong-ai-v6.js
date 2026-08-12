/* V6 HP30 revision: durable-unit evaluation and a longer cached rollout. */
const v6OpeningMode={P1:"balanced",P2:"balanced"};
function v6StateKey(s,plies){return plies+"|"+s.turn+"|"+s.currentPlayer+"|"+s.energy.P1+","+s.energy.P2+"|"+s.towers.map(t=>t.hp).join(",")+"|"+aliveUnits(s).map(u=>u.owner+":"+u.cardId+":"+u.position+":"+u.hp+":"+(u.shield||0)).sort().join(";")+"|"+s.hands.P1.join(",")+"|"+s.hands.P2.join(",")}
function v6Evaluate(s,me,mode){
  const end=outcome(s);if(end)return strongEvaluate(s,me);
  let score=v3Evaluate(s,me,mode),enemy=foe(me);
  for(const u of aliveUnits(s)){
    const sign=u.owner===me?1:-1,card=CARDS[u.cardId],ratio=u.hp/u.maxHp;
    const targets=aliveTowers(s).filter(t=>t.owner!==u.owner),d=targets.length?Math.min(...targets.map(t=>dist(u.position,t.position))):12;
    score+=sign*(ratio*card.cost*105+Math.min(u.hp,u.damage*2)*18+Math.max(0,7-d)*(u.towerOnly?75:32));
  }
  const threatened=p=>aliveUnits(s).filter(u=>u.owner!==p&&aliveTowers(s).some(t=>t.owner===p&&dist(u.position,t.position)<=u.range+1)).length;
  score+=(threatened(enemy)-threatened(me))*190;
  return score;
}
function v6FastAction(s,root,mode){
  const max=s.currentPlayer===root;let chosen=null,best=max?-Infinity:Infinity;
  for(const action of strongCandidates(s,8)){const value=v6Evaluate(applyAction(s,action),root,mode);if(chosen===null||(max?value>best:value<best)){chosen=action;best=value}}
  return chosen;
}
function v6Rollout(s,root,mode,plies,cache){
  const key=v6StateKey(s,plies);if(cache?.has(key))return cache.get(key);
  let n=s;for(let i=0;i<plies&&!outcome(n);i++)n=applyAction(n,v6FastAction(n,root,mode));
  const value=v6Evaluate(n,root,mode);if(cache)cache.set(key,value);return value;
}
function v6Proposal(s,me,mode,width,plies){const roots=strongCandidates(s,width);let chosen=roots[0],best=-Infinity;for(const action of roots){const next=applyAction(s,action),end=outcome(next);if(end?.winner===me)return action;const score=v4Rollout(next,me,mode,plies);if(score>best||(score===best&&action.id<chosen.id)){best=score;chosen=action}}return chosen}
function chooseStrongActionV6(s,me=s.currentPlayer){
  if((me==="P1"&&s.turn<=1)||(me==="P2"&&s.turn<=2))v6OpeningMode[me]=v3ModeForOpening(s,me);
  const mode=v6OpeningMode[me],proposals=[chooseStrongActionV5(s,me),v6Proposal(s,me,mode,30,8),v6Proposal(s,me,mode,18,10)].filter((a,i,x)=>x.findIndex(b=>b.id===a.id)===i);let chosen=proposals[0],best=-Infinity;
  for(const action of proposals){
    const next=applyAction(s,action),end=outcome(next);if(end?.winner===me)return action;
    const reply=chooseStrongActionV5(next,next.currentPlayer),after=applyAction(next,reply);let score=v6Evaluate(after,me,mode);
    if(!outcome(after))for(const follow of strongCandidates(after,8))score=Math.max(score,v6Evaluate(applyAction(after,follow),me,mode));
    if(score>best||(score===best&&action.id<chosen.id)){best=score;chosen=action}
  }
  return chosen
}
