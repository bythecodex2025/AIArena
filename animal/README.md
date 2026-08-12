# 동물장기 AI 연구실 v1~v5

정확한 동물장기 규칙 엔진, 성능별 예제 AI 5종, 전수 상태 그래프/후퇴 분석기, 사용자 JavaScript AI 대전장을 한 프로젝트에 담았습니다.

## 실행

```powershell
cd D:\codex_prj\animal-shogi-ai-prototype
python -m http.server 8081
```

브라우저에서 `http://127.0.0.1:8081`을 엽니다.

```powershell
npm.cmd test
node benchmark.mjs --games=2
```

PowerShell 실행 정책에 따라 `npm` 대신 `npm.cmd`가 필요할 수 있습니다.

## 내 AI 코드로 대전

웹 화면의 **내 AI 코드로 예제 AI와 대전** 영역에서 `chooseMove(state, me)` 함수를 작성합니다. 기본 예제를 수정하거나 다른 AI/LLM에 화면의 **LLM용 규격 복사** 내용을 전달해 코드를 만든 뒤 붙여 넣을 수 있습니다.

- **코드 1수 검증**: 초기 국면에서 합법 수를 반환하는지 즉시 확인
- **AI 파일 불러오기**: 클립보드 대신 50KB 이하 `.js`·`.txt` 파일을 코드 손실 없이 불러오기
- **성능별 대전**: v1~v5 중 하나 또는 전체를 선택하고, 상대마다 내 AI의 선공·후공을 같은 횟수로 교대
- **경기별 로그**: 각 대국의 수순·결과·종료 사유를 클립보드로 복사하거나 UTF-8 TXT 파일로 다운로드
- **실전 선택**: 선수 설정에서 `내 AI 코드`를 골라 사람이나 다른 예제 AI와 대국
- **실행 제한**: 코드 50KB, 한 수 500ms, 한 경기 240수

사용자 코드는 별도 Web Worker에서 실행되고, 반환한 수는 규칙 엔진이 다시 검증합니다. 무한 루프는 제한 시간에 Worker를 종료합니다. 다만 브라우저 Worker는 신뢰할 수 없는 코드를 위한 완전한 보안 경계가 아니므로, 출처를 모르는 코드를 실행하거나 코드에 비밀번호·토큰 같은 비밀값을 넣지 마세요.

## AI 단계

| 버전 | 방식 | 기본 계산량 | 용도 |
|---|---|---:|---|
| v1 | 합법 수 무작위 | 1노드 | 입문/최약체 |
| v2 | 1수 정적 평가 | 평균 합법 수만큼 | 포획·트라이 학습 |
| v3 | 3수 미니맥스 | 수십~수백 노드 | 기본 수읽기 |
| v4 | 6수 알파베타 + 전치표 | 수천 노드 | 강한 로컬 AI |
| v5 | 정확 테이블베이스 우선 + 반복 심화 폴백 | 시간 제한까지 | 최강/완전해 연동 |

각 AI의 최소 래퍼는 [`example-ais`](./example-ais)에 있습니다. 실제 공통 탐색 구현은 [`ai.js`](./ai.js), 규칙 구현은 [`engine.js`](./engine.js)입니다.

## “모든 경우의 수”의 정확한 의미

동물장기는 전체 상태 공간을 분석한 연구가 공개되어 있습니다. 초기 상태에서 도달 가능한 상태는 246,803,167개이고, 그중 비종료 상태 99,485,568개가 승/무/패로 분류됐습니다. 이 수치는 [田中哲朗의 완전해석 논문](https://www.tanaka.ecc.u-tokyo.ac.jp/ktanaka/dobutsushogi/animal-private.pdf)과 [공개 프로그램/데이터 설명](https://www.tanaka.ecc.u-tokyo.ac.jp/ktanaka/dobutsushogi/)에 근거합니다.

전체 테이블베이스는 소스 코드에 넣기에는 수백 MB이고 생성 시 대용량 메모리가 필요합니다. 따라서 이 저장소는 다음처럼 분리합니다.

- [`exhaustive-solver.js`](./exhaustive-solver.js): 상태 열거 → 역방향 간선 구성 → 후퇴 분석 → 승/무/패 및 DTM 계산을 실제 구현합니다.
- [`tablebase-generator.mjs`](./tablebase-generator.mjs): 작은/부분 국면은 즉시 정확히 풀고, `--full`이면 같은 알고리즘으로 한도 없이 열거합니다.
- [`ai.js`](./ai.js)의 v5: 생성된 테이블베이스가 설치돼 있으면 정확해를 사용하고, 없으면 제한 시간 반복 심화로 안전하게 폴백합니다.
- UI의 `V5 TABLEBASE` 숫자가 `0`이면 정확 데이터가 아직 적재되지 않았다는 뜻입니다. 이 상태의 v5를 “완전무결 AI”라고 오해하지 않도록 의도적으로 표시합니다.

전체 생성 명령은 실험용입니다.

```powershell
npm.cmd run tablebase:sample
npm.cmd run tablebase:full
```

JavaScript 객체 기반 전체 생성은 연구용 구조 검증에 적합하지만 메모리 효율은 낮습니다. 실제 2~3분대 전체 생성/333MB 테이블베이스가 필요하면 MIT 라이선스 Rust 구현인 [brianhliou/dobutsu-shogi](https://github.com/brianhliou/dobutsu-shogi)의 dense solver/probe 방식을 사용하는 것이 현실적입니다. 이 프로젝트의 v5 `installTablebase(entries)` 인터페이스에 변환한 결과를 연결할 수 있습니다.

## 구현한 규칙

- 3×4 보드, 라이온/기린/코끼리/병아리/닭의 이동
- 포획한 말을 내 말로 빈칸 어디에나 놓기
- 병아리의 끝줄 이동 승격, 닭 포획 시 병아리 환원
- 라이온 포획 및 “다음 상대 수까지 생존”하는 트라이
- 동일한 보드·잡은 말·차례가 세 번째 나타나면 무승부
- 동물장기에는 이보(같은 세로줄 병아리), 마지막 줄 병아리 놓기, 병아리 놓기 외통 금지가 없음
- 라이온을 잡힐 수 있는 칸으로 움직이는 수도 금지 수가 아니며, 실제로 다음 수에 잡히면 패배

규칙 교차 확인: [Lishogi Dobutsu 규칙](https://lishogi.org/variant/dobutsu), [일본어 상세 규칙](https://train.gomi.info/trainshogi/rule/).

## 파일 구조

```text
animal-shogi-ai-prototype/
├─ index.html / styles.css / app.js   # 대국·코드 대전·탐색 계측 UI
├─ engine.js                          # 순수 규칙 엔진
├─ ai.js                              # v1~v5 구현과 테이블베이스 인터페이스
├─ custom-ai-runner.js                # 사용자 AI 검증·Worker 호출
├─ custom-ai-worker.js                # 시간 제한이 적용되는 코드 실행기
├─ exhaustive-solver.js               # 상태 그래프 + 후퇴 분석
├─ tablebase-generator.mjs             # 오프라인 생성 CLI
├─ example-ais/                        # 단계별 최소 사용 예제
├─ tests/                              # 규칙·AI·후퇴 분석 테스트
└─ benchmark.mjs                       # AI 라운드로빈 벤치마크
```

## 검증

- Node 단위 테스트 23개 통과
- 초기 합법 수 4개, 승격/환원/끝줄 놓기/트라이/포획 검증
- 작은 상태 그래프의 정확 후퇴 분석 결과 및 상태 한도 실패 안전성 검증
- 브라우저에서 사용자 AI 합법 수 반환, 무한 루프 500ms 종료, v1 선·후수 교대 대전 및 결과 집계 확인
- 브라우저 경고/오류 로그 없음
