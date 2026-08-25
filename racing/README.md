# Vector Racing

고정 15 TPS 물리에서 도로 센서를 읽고 차량을 제어하는 AIArena 레이싱 예제입니다.

## AI 계약

```js
function chooseAction(state, me) {
  return state.legalActions[0];
}
```

- 매 틱 `1 / 15`초의 고정 시간 단계
- 행동 15개: 스로틀 `-1, 0, 1` × 조향 `-1, -0.5, 0, 0.5, 1`
- `road.lookahead`: 0, 6, 12, 20, 30, 45, 65, 90m 전방의 중심 좌표·방향·곡률·도로 폭·권장 속도
- `road.nearest`: 현재 진행 거리·중앙선 오프셋·헤딩 오차
- `road.edgeDistance`: 좌·우 도로 경계까지 거리
- 양쪽 차량의 속도·자세·랩·진행 거리·코스 이탈 횟수 공개
- 3랩 선착순, 최대 3,000틱(논리 시간 200초)
- 시드 기반 트랙, 좌우 출발 위치와 P1/P2를 교대하는 공정 대전
- 3연속 대형 코너, 5개 급커브와 짧은 S자 굴곡을 합성한 복합 코스
- 지속 Web Worker, 코드 50KB, 행동 500ms, 동기 반환과 합법 행동 재검증

차량은 서로 충돌하지 않는 고스트 방식입니다. 도로 해석과 제어 알고리즘만 비교할 수 있습니다.
`browser-bundle.js`와 Blob Worker를 사용하므로 `index.html`을 `file://`로 직접 열어도 실행됩니다.

## 검증

```powershell
npm.cmd test
```

브라우저 번들을 다시 생성하려면 `npm.cmd run build`를 실행합니다.

## Strong AI

`strong-ai.js`는 엔진의 yaw 모델을 역산하는 feed-forward 조향과 전방 제동 거리 계산을 사용합니다. 편집기에서 **V5 압도 AI 불러오기**를 누르거나 파일 전체를 복사해 사용할 수 있습니다.

```powershell
npm.cmd run benchmark:strong
```
