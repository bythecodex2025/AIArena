import test from"node:test";import assert from"node:assert/strict";import{applyAction,formatTime,initialState,legalActions,outcome,publicState,travelTime}from"../engine.js";
test("같은 시드는 같은 배송 게시판을 만든다",()=>assert.deepEqual(initialState({seed:3}).jobs,initialState({seed:3}).jobs));
test("구역 간 이동 시간은 대칭이다",()=>assert.equal(travelTime("A","C"),travelTime("C","A")));
test("배송은 시간과 점수를 진행시킨다",()=>{let s=initialState({seed:2,forceFirst:"P1"});const a=legalActions(s).find(x=>x.type==="deliver"&&!x.express);s=applyAction(s,a);assert.equal(s.couriers.P1.time,a.finish);assert.equal(s.couriers.P1.score,a.gain)});
test("완료한 공유 의뢰는 게시판에서 교체된다",()=>{let s=initialState({seed:2,forceFirst:"P1"});const a=legalActions(s).find(x=>x.type==="deliver");const id=a.jobId;s=applyAction(s,a);assert.equal(s.jobs.some(j=>j.jobId===id),false);assert.equal(s.jobs.length,4)});
test("공개 상태는 숨은 의뢰 덱을 노출하지 않는다",()=>{const v=publicState(initialState(),"P1");assert.equal("jobDeck"in v,false);assert.ok(v.nextJob)});
test("양쪽이 마감하면 경기가 끝난다",()=>{let s=initialState({seed:4});while(!outcome(s)){const close=legalActions(s).find(a=>a.type==="close");s=applyAction(s,close??legalActions(s)[0]);}assert.ok(outcome(s).reason);assert.ok(s.ply<=s.maxPlies)});
test("시간 표시는 08시 기준이다",()=>assert.equal(formatTime(5),"13:00"));
