# Echo Vault

숨은 3문양 암호를 피드백으로 좁히는 2인 논리 추론 AIArena 예제입니다.

- 암호: `△ ○ □ ◇` 중 중복 없는 3문양
- 피드백: 위치까지 정확한 수와 문양만 맞는 수
- 종료: 같은 라운드의 응답 기회를 보장하며, 먼저 완전 해독하거나 6회 뒤 더 적은 후보를 남긴 플레이어 승리
- AI: 무작위, 후보 추적, 미니맥스 분할, 엔트로피 탐색
- 사용자 AI: `chooseAction(state, me)`, 50KB, 500ms, Worker 격리

`npm.cmd test`와 `npm.cmd run benchmark`로 검증할 수 있습니다.
