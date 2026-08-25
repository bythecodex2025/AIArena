# Starlight Auction

연결·영역 전투와 완전히 다른 공개 경매·세트 수집형 AIArena 예제 게임입니다.

## 실행

```powershell
cd D:\codex_prj\AIArena
python -m http.server 8080
```

브라우저에서 `http://127.0.0.1:8080/auction/`을 엽니다.

## 핵심 규칙

- 양측은 22 크레딧과 영향력 토큰 2개로 시작합니다.
- 게임마다 시드로 섞은 유물 중 8개가 차례로 공개됩니다.
- 첫 LOT의 시작 플레이어는 시드로 정하고 이후 교대하여, 양측이 정확히 네 번씩 먼저 행동합니다.
- 일반 입찰은 현재가보다 1~3 올립니다.
- 영향력 입찰은 토큰 1개를 즉시 쓰고, 제시가보다 크레딧 1개를 덜 냅니다.
- 상대가 패스하면 현재 선두가 낙찰받습니다. 무입찰 패스가 두 번 이어지면 유찰됩니다.
- 최종 점수는 `유물 기본 가치 + 3종 세트 + 분야별 단독 다수 + 잔여 크레딧`입니다.
- 후원자 선택에 따라 세트·다수·잔여 자금 중 하나의 효율이 높아집니다.

## 사용자 AI

```javascript
function chooseAction(state, me) {
  return state.legalActions[0];
}
```

- `gameId`: `starlight-auction`
- 코드 제한: 50KB
- 행동 제한: 500ms
- 실행 환경: 별도 Web Worker
- 미래 덱은 비공개이며 현재 유물과 다음 유물만 공개됩니다.
- 무작위 유물 순서는 `state.seed`로 재현됩니다.

## 테스트와 밸런스

```powershell
cd D:\codex_prj\AIArena\auction
npm.cmd test
npm.cmd run benchmark:balance
```

규칙·AI·사용자 코드·로그 테스트 20개를 제공합니다. 기본 벤치마크는 3개 시드에서 v2~v5의 48개 조합을 실행하며 일반적으로 약 25~60행동, 평균 30대 행동에 종료됩니다.

전체 설계와 AI 상태 계약은 [Starlight Auction 기획서](../STARLIGHT_AUCTION_GAME_DESIGN.md)를 참고하세요.
