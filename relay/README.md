# Relay Forge

5×5 전장에서 내 기지로부터 통신망을 확장하고, 중앙 중계기 점령 또는 상대 기지 해킹을 노리는 AIArena 예제 게임입니다.

## 실행

저장소 루트에서 정적 서버를 실행합니다.

```powershell
cd D:\codex_prj\AIArena
python -m http.server 8080
```

브라우저에서 `http://127.0.0.1:8080/relay/`을 엽니다.

## 테스트

```powershell
cd D:\codex_prj\AIArena\relay
npm.cmd test
```

## 사용자 AI

```javascript
function chooseAction(state, me) {
  const swap = state.legalActions.find((action) => action.type === "swap");
  if (swap) return swap;
  return state.legalActions[0];
}
```

- 코드 제한: 50KB
- 행동 제한: 500ms
- 경기 제한: 48반수
- 반환값: `state.legalActions`의 객체, 행동 ID 또는 같은 ID의 객체
- 실행 환경: 별도 Web Worker

### 중앙 중계기 균형 규칙

- 중계기 `5`, `12`, `19`는 노드를 놓을 수 없는 중립 시설입니다.
- 각 중계기 주변의 활성 노드 수가 더 많은 플레이어가 점령합니다.
- 점령하려면 주변에 최소 2개의 활성 노드가 필요합니다.
- 양측의 영향력이 같으면 경합 상태이며 어느 쪽의 점령으로도 계산하지 않습니다.
- 따라서 중앙 직선 확장은 빠르지만, 상대가 맞은편에 노드 하나를 놓으면 점령이 해제됩니다.

### 첫 수 스왑 규칙

- P1의 첫 행동 직후 P2에게만 비용 0의 `swap` 행동이 한 번 제공됩니다.
- P2가 `swap`을 고르면 보드를 180도 돌리고 양측 진영·노드·에너지를 교환합니다.
- P1의 첫 수가 압도적으로 좋다면 P2가 그 수를 넘겨받을 수 있으므로, 특정 첫 수를 P1만 독점하는 전략은 성립하지 않습니다.
- `swap`을 고르지 않고 다른 행동을 하면 그 경기에서는 다시 사용할 수 없습니다.

### 진행과 반복 방지 규칙

- 자기 행동 직후 보유 중계기 하나당 신호 1점을 얻고, 먼저 5점을 만들면 승리합니다.
- 승부는 P2의 응답까지 끝난 라운드 경계에서 판정해 양측에 같은 횟수의 득점 기회를 줍니다.
- 같은 라운드에 양쪽이 5점 동점이면 즉시 무승부입니다.
- 과거에 나온 보드·에너지·신호 점수·차례를 그대로 만드는 행동은 합법 행동에서 제외됩니다.
- 새로운 전체 상태를 만들 수 있는 행동이 없으면 `settle`로 즉시 현재 우위를 정산합니다.

AI 조합별 선후공 결과는 다음 명령으로 확인할 수 있습니다.

```powershell
npm.cmd run benchmark:balance
```

현재 내장 AI v2~v5의 16개 교차 대전 결과는 `P1 5승 · P2 5승 · 무승부 6회`이며 모든 경기가 `12~14반수`에 종료됐습니다. 이 수치는 완전한 게임 해석의 증명은 아니지만, 선후공 편향과 반복 교착이 다시 생기는지 확인하는 회귀 지표로 사용합니다.

## 구성

```text
relay/
├─ engine.js             규칙, 합법 행동, 상태 전이와 종료 판정
├─ ai.js                 예제 AI v1~v5
├─ custom-ai-runner.js   사용자 코드 검증과 Worker 관리
├─ custom-ai-worker.js   격리된 사용자 코드 실행
├─ battle-log.js         공정 일정과 TXT 로그
├─ app.js                직접 플레이, 자동 대전과 리플레이
├─ index.html / styles.css
└─ tests/                엔진, AI, 사용자 코드와 로그 테스트
```

전체 규칙과 설계 근거는 [Relay Forge 기획서](../RELAY_FORGE_GAME_DESIGN.md)를 참고하세요.
