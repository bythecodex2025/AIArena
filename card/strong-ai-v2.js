/* Strong AI V2: deeper lane-aware search built on the exact game engine and V1 helpers. */
function v2Lane(position){const c=position%W;return c<=2?"left":c>=4?"right":"center"}

function v2Evaluate(s,me){
  return strongEvaluate(s,me);
}

function v2Candidates(s,limit){
  return strongCandidates(s,limit);
}

function v2Search(s,depth,alpha,beta,me,deadline,ply){
  const end=outcome(s);if(end||depth===0||Date.now()>=deadline)return v2Evaluate(s,me);
  const limits=[16,10,6,4],actions=v2Candidates(s,limits[Math.min(ply,limits.length-1)]),max=s.currentPlayer===me;
  let best=max?-Infinity:Infinity;
  for(const action of actions){
    const value=v2Search(applyAction(s,action),depth-1,alpha,beta,me,deadline,ply+1);
    if(max){best=Math.max(best,value);alpha=Math.max(alpha,best)}else{best=Math.min(best,value);beta=Math.min(beta,best)}
    if(beta<=alpha||Date.now()>=deadline)break;
  }
  return best;
}

function chooseStrongActionV2(s,me=s.currentPlayer,options={}){
  const deadline=Date.now()+(options.budgetMs??(me==="P1"?120:50)),root=v2Candidates(s,options.rootCandidates??16);
  for(const action of root){const end=outcome(applyAction(s,action));if(end?.winner===me)return action}
  let chosen=root[0],completed=0;
  const maxDepth=options.depth??3;
  for(const depth of[2,3]){
    if(depth>maxDepth)break;
    let local=chosen,best=-Infinity,finished=true;
    for(const action of root){
      if(Date.now()>=deadline){finished=false;break}
      const value=v2Search(applyAction(s,action),depth-1,-Infinity,Infinity,me,deadline,1);
      if(value>best||(value===best&&action.id<local.id)){best=value;local=action}
    }
    if(finished){chosen=local;completed=depth}else break;
  }
  chooseStrongActionV2.lastDepth=completed;
  return chosen;
}
