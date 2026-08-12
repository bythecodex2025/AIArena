/* Turn Card Arena built-in deterministic search AI. Requires engine globals from app.js. */
function strongArea(center){
  const [r,c]=rc(center),cells=[];
  for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
    if(Math.abs(dr)+Math.abs(dc)<=1&&inside(r+dr,c+dc))cells.push(pos(r+dr,c+dc));
  }
  return cells;
}

function strongActionHeuristic(s,action,player){
  if(action.type==="pass")return s.energy[player]>=9?-900:-80+s.energy[player]*18;
  const card=CARDS[action.cardId],enemy=foe(player),cells=strongArea(action.position);
  if(card.kind==="spell"){
    if(card.damage){
      let score=0;
      for(const t of aliveTowers(s).filter(x=>x.owner===enemy&&cells.includes(x.position))){
        score+=Math.min(2,t.hp)*700+(t.hp<=2?(t.type==="core"?500000:18000):0);
      }
      for(const u of aliveUnits(s).filter(x=>x.owner===enemy&&cells.includes(x.position))){
        const dealt=Math.min(card.damage,u.hp);score+=dealt*180+(u.hp<=card.damage?CARDS[u.cardId].cost*500:0);
      }
      return score-card.cost*30;
    }
    let score=0;
    for(const u of aliveUnits(s).filter(x=>x.owner===player&&cells.includes(x.position))){
      const healed=Math.min(card.heal,u.maxHp-u.hp);score+=healed*190+(healed&&u.hp<=3?350:0);
    }
    return score-card.cost*30;
  }
  const enemyTowers=aliveTowers(s).filter(t=>t.owner===enemy);
  const ownCore=aliveTowers(s).find(t=>t.id===`${player}-core`);
  const threats=aliveUnits(s).filter(u=>u.owner===enemy).sort((a,b)=>dist(a.position,ownCore.position)-dist(b.position,ownCore.position));
  const towerDistance=enemyTowers.length?Math.min(...enemyTowers.map(t=>dist(action.position,t.position))):20;
  const threatDistance=threats.length?dist(action.position,threats[0].position):20;
  const forwardRow=player==="P1"?H-1-Math.floor(action.position/W):Math.floor(action.position/W);
  let score=card.cost*90+forwardRow*45-towerDistance*35;
  if(threatDistance<=card.range+2)score+=450-threatDistance*70;
  if(card.towerOnly)score+=650-towerDistance*65;
  if(card.range>=3)score+=180;
  if(card.shield)score+=120;
  if(card.count===2){
    const free=neighbors(action.position).some(p=>!occupied(s,p));score+=free?260:-500;
  }
  const friendlyFront=aliveUnits(s).some(u=>u.owner===player&&dist(u.position,action.position)===1);
  if(friendlyFront)score+=110;
  return score;
}

function strongCandidates(s,limit=12){
  const player=s.currentPlayer,actions=legalActions(s,player);
  const pass=actions.find(a=>a.type==="pass");
  const ranked=actions.filter(a=>a.type!=="pass").map(a=>({a,score:strongActionHeuristic(s,a,player)}));
  ranked.sort((x,y)=>y.score-x.score||x.a.id.localeCompare(y.a.id));
  const picked=ranked.slice(0,Math.max(0,limit-1)).map(x=>x.a);
  if(pass)picked.push(pass);
  return picked.length?picked:[pass];
}

function strongEvaluate(s,me){
  const end=outcome(s);
  if(end)return !end.winner?0:end.winner===me?1000000-(s.turn||0):(-1000000+(s.turn||0));
  const enemy=foe(me);
  let score=0;
  for(const t of s.towers){
    const sign=t.owner===me?1:-1;
    if(t.hp<=0)score-=sign*(t.type==="core"?500000:12000);
    else score+=sign*Math.max(0,t.hp)*(t.type==="core"?450:220);
  }
  for(const u of aliveUnits(s)){
    const sign=u.owner===me?1:-1,card=CARDS[u.cardId];
    let value=u.hp*45+u.damage*110+u.range*45+u.move*35+(u.shield||0)*55+card.cost*80;
    const targets=aliveTowers(s).filter(t=>t.owner!==u.owner);
    const nearestTower=targets.length?Math.min(...targets.map(t=>dist(u.position,t.position))):20;
    value+=Math.max(0,9-nearestTower)*55;
    if(targets.some(t=>dist(u.position,t.position)<=u.range))value+=u.damage*350;
    if(u.towerOnly)value+=Math.max(0,10-nearestTower)*70;
    score+=sign*value;
  }
  score+=(s.energy[me]-s.energy[enemy])*35;
  for(const p of[me,enemy])if(s.energy[p]>=9){const sign=p===me?1:-1;score-=sign*90;}
  const myCore=aliveTowers(s).find(t=>t.id===`${me}-core`),enemyCore=aliveTowers(s).find(t=>t.id===`${enemy}-core`);
  if(myCore)for(const u of aliveUnits(s).filter(x=>x.owner===enemy))score-=Math.max(0,8-dist(u.position,myCore.position))*120;
  if(enemyCore)for(const u of aliveUnits(s).filter(x=>x.owner===me))score+=Math.max(0,8-dist(u.position,enemyCore.position))*120;
  return score;
}

function strongSearch(s,depth,alpha,beta,me,deadline,branches){
  if(depth===0||outcome(s)||Date.now()>=deadline)return strongEvaluate(s,me);
  const maximizing=s.currentPlayer===me,limit=branches[Math.min(branches.length-1,branches.rootDepth-depth)]||4;
  const actions=strongCandidates(s,limit);
  if(maximizing){
    let best=-Infinity;
    for(const action of actions){
      best=Math.max(best,strongSearch(applyAction(s,action),depth-1,alpha,beta,me,deadline,branches));
      alpha=Math.max(alpha,best);if(beta<=alpha||Date.now()>=deadline)break;
    }
    return best;
  }
  let best=Infinity;
  for(const action of actions){
    best=Math.min(best,strongSearch(applyAction(s,action),depth-1,alpha,beta,me,deadline,branches));
    beta=Math.min(beta,best);if(beta<=alpha||Date.now()>=deadline)break;
  }
  return best;
}

function chooseStrongAction(s,me=s.currentPlayer,options={}){
  const budgetMs=options.budgetMs??180,deadline=Date.now()+budgetMs;
  const root=strongCandidates(s,options.rootCandidates??12);
  let chosen=root[0],best=-Infinity;
  for(const action of root){
    const next=applyAction(s,action),end=outcome(next);
    if(end?.winner===me)return action;
    const score=strongEvaluate(next,me);
    if(score>best||(score===best&&action.id<chosen.id)){best=score;chosen=action;}
  }
  const tactical=root.some(a=>{
    if(a.type!=="play")return false;
    const next=applyAction(s,a),end=outcome(next);
    return !!end||Math.abs(strongEvaluate(next,me)-strongEvaluate(s,me))>2500;
  });
  const depth=options.depth??(tactical?3:2),branches={0:options.rootCandidates??12,1:options.replyCandidates??8,2:options.thirdCandidates??4,rootDepth:depth};
  best=-Infinity;
  for(const action of root){
    if(Date.now()>=deadline)break;
    const score=strongSearch(applyAction(s,action),depth-1,-Infinity,Infinity,me,deadline,branches);
    if(score>best||(score===best&&action.id<chosen.id)){best=score;chosen=action;}
  }
  return chosen;
}
