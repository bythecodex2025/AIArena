export const RULES_VERSION = "1.0.0";
export const MAX_TIME = 12;
export const MAX_PLIES = 30;
export const DISTRICTS = Object.freeze({ HUB: "중앙 터미널", A: "오로라", B: "브라스", C: "코발트", D: "도크 9" });
export const JOBS = Object.freeze([
  job("aurora-ink","오로라 잉크","A",1,4,5), job("brass-gears","황동 기어","B",2,6,7),
  job("cobalt-film","코발트 필름","C",1,5,5), job("dock-medicine","도크 의약품","D",2,4,8),
  job("sun-letters","태양 우편","A",2,8,7), job("clock-spring","시계 태엽","B",1,7,5),
  job("night-reel","야간 필름","C",3,10,9), job("harbor-seed","항만 종자","D",1,7,6),
  job("aurora-glass","편광 유리","A",3,11,9), job("brass-score","악단 악보","B",2,9,7),
  job("cobalt-sample","빙하 샘플","C",2,8,8), job("dock-tea","궤도 홍차","D",2,10,7),
  job("museum-key","박물관 열쇠","A",1,3,7), job("foundry-chip","주조 칩셋","B",3,12,10),
  job("studio-lens","스튜디오 렌즈","C",1,6,6), job("captain-map","선장 항로도","D",3,11,10),
]);

const DISTANCE = Object.freeze({
  HUB: { HUB:0,A:1,B:2,C:2,D:1 }, A: { HUB:1,A:0,B:1,C:2,D:2 },
  B: { HUB:2,A:1,B:0,C:1,D:2 }, C: { HUB:2,A:2,B:1,C:0,D:1 }, D: { HUB:1,A:2,B:2,C:1,D:0 },
});

export function initialState({ seed = 20260814, forceFirst } = {}) {
  const shuffled = shuffle(JOBS.map((item,index)=>({ ...item, jobId:`${item.id}-${index}` })),seed);
  return { gameId:"chrono-courier",rulesVersion:RULES_VERSION,seed:seed>>>0,ply:0,maxPlies:MAX_PLIES,currentPlayer:forceFirst??((seed>>>0)%2===0?"P1":"P2"),jobs:shuffled.slice(0,4),jobDeck:shuffled.slice(4),couriers:{P1:newCourier(),P2:newCourier()},winner:null,reason:null,lastActions:[] };
}

export function cloneState(state){return JSON.parse(JSON.stringify(state));}

export function legalActions(state,player=state.currentPlayer){
  if(outcome(state)||player!==state.currentPlayer||state.couriers[player].done)return[];
  const courier=state.couriers[player],actions=[];
  for(const task of state.jobs){
    const standard=project(courier,task,false); if(standard.finish<=MAX_TIME)actions.push(deliveryAction(task,standard,false));
    const express=project(courier,task,true); if(courier.energy>0&&standard.travel>0&&express.finish<=MAX_TIME)actions.push(deliveryAction(task,express,true));
  }
  if(courier.time<MAX_TIME&&courier.energy<3)actions.push({id:"rest",type:"rest",finish:courier.time+1});
  if(!actions.length||courier.time>=9)actions.push({id:"close",type:"close"});
  return actions;
}

export function applyAction(state,requested){
  const actionId=typeof requested==="string"?requested:requested?.id;const action=legalActions(state).find(item=>item.id===actionId);if(!action)throw new Error(`불법 행동: ${actionId??"undefined"}`);
  const next=cloneState(state),player=next.currentPlayer,courier=next.couriers[player];let text="";
  if(action.type==="deliver"){
    const index=next.jobs.findIndex(item=>item.jobId===action.jobId),task=next.jobs[index];
    courier.time=action.finish;courier.location=task.district;courier.score+=action.gain;courier.lastDistrict=task.district;if(action.express)courier.energy-=1;
    courier.completed.push({...task,gain:action.gain,finish:action.finish,express:action.express});next.jobs.splice(index,1);if(next.jobDeck.length)next.jobs.push(next.jobDeck.shift());
    text=`${task.name} → ${DISTRICTS[task.district]} · ${formatTime(action.finish)} · +${action.gain}점${action.express?" · 특급":""}`;
  }else if(action.type==="rest"){courier.time+=1;courier.energy=Math.min(3,courier.energy+1);text=`정비 휴식 · ${formatTime(courier.time)} · 특급 +1`;}
  else{courier.time=MAX_TIME;courier.done=true;text="오늘 배송 마감";}
  if(courier.time>=MAX_TIME)courier.done=true;next.ply+=1;next.lastActions=[{player,actionId:action.id,text}];
  if(next.ply>=next.maxPlies||(next.couriers.P1.done&&next.couriers.P2.done))settle(next);else{const other=otherPlayer(player);next.currentPlayer=next.couriers[other].done?player:other;}
  return next;
}

export function outcome(state){return state.reason?{winner:state.winner,reason:state.reason}:null;}
export function publicState(state,viewer=state.currentPlayer){return{gameId:state.gameId,rulesVersion:state.rulesVersion,seed:state.seed,ply:state.ply,maxPlies:state.maxPlies,currentPlayer:state.currentPlayer,maxTime:MAX_TIME,districts:DISTRICTS,jobs:cloneState(state.jobs),nextJob:state.jobDeck[0]?{...state.jobDeck[0]}:null,couriers:cloneState(state.couriers),viewer,lastActions:cloneState(state.lastActions),legalActions:legalActions(state,viewer)};}
export function actionText(action){if(action.type==="rest")return"정비 휴식";if(action.type==="close")return"배송 마감";return`${action.name} 배송${action.express?" · 특급":""}`;}
export function turnLabel(state){return outcome(state)?"운행 종료":`${state.currentPlayer} · ${formatTime(state.couriers[state.currentPlayer].time)}`;}
export function progress(state){return(state.couriers.P1.time+state.couriers.P2.time)/(MAX_TIME*2);}
export function stateKey(state){return JSON.stringify([state.currentPlayer,state.jobs.map(item=>item.jobId),state.couriers]);}
export function travelTime(from,to){return DISTANCE[from][to];}
export function formatTime(time){return`${String(8+time).padStart(2,"0")}:00`;}

function project(courier,task,express){const travel=DISTANCE[courier.location][task.district],usedTravel=Math.max(0,travel-(express?1:0)),finish=courier.time+usedTravel+task.duration,onTime=finish<=task.deadline,base=Math.max(1,task.reward-Math.max(0,finish-task.deadline)*2),chain=courier.lastDistrict===task.district?2:0,gain=base+(onTime?2:0)+chain;return{travel,usedTravel,finish,onTime,chain,gain};}
function deliveryAction(task,p,express){return{id:`${express?"express":"deliver"}:${task.jobId}`,type:"deliver",jobId:task.jobId,name:task.name,district:task.district,finish:p.finish,travel:p.usedTravel,gain:p.gain,onTime:p.onTime,chain:p.chain,express};}
function settle(state){const a=state.couriers.P1,b=state.couriers.P2;if(a.score!==b.score)state.winner=a.score>b.score?"P1":"P2";else if(a.completed.length!==b.completed.length)state.winner=a.completed.length>b.completed.length?"P1":"P2";else if(a.energy!==b.energy)state.winner=a.energy>b.energy?"P1":"P2";state.reason=state.winner?`${state.winner}이 ${a.score}:${b.score}로 더 가치 있는 하루를 완성했습니다.`:`${a.score}:${b.score}, 배송 수와 특급 에너지까지 같아 무승부입니다.`;}
function job(id,name,district,duration,deadline,reward){return Object.freeze({id,name,district,duration,deadline,reward});}
function newCourier(){return{time:0,location:"HUB",energy:2,score:0,lastDistrict:null,completed:[],done:false};}
function otherPlayer(player){return player==="P1"?"P2":"P1";}
function shuffle(items,seed){const random=mulberry32(seed>>>0),copy=[...items];for(let index=copy.length-1;index>0;index--){const target=Math.floor(random()*(index+1));[copy[index],copy[target]]=[copy[target],copy[index]];}return copy;}
function mulberry32(seed){return()=>{seed|=0;seed=seed+0x6d2b79f5|0;let value=Math.imul(seed^seed>>>15,1|seed);value=value+Math.imul(value^value>>>7,61|value)^value;return((value^value>>>14)>>>0)/4294967296;};}
