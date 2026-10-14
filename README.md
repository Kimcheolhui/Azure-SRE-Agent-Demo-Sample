# SRE Agent Demo

로컬 저장소 루트: `SRE-Agent-Demo/Azure-SRE-Agent-Demo-Sample`.
npm·azd·Git 명령은 이 폴더에서 실행합니다.

Azure SRE Agent 고객 데모를 위한 독립 실행 패키지입니다. 기존 AKS 결제 샘플과 별도
RG에 배포하며, 공유 AbortController 결함을 실제 HTTP 요청·CPU 연산·로그로 재현합니다.

- [30분 진행 가이드와 직접 입력할 구성 내용](docs/demo-guide.md)
- [리허설 검증 기록과 제약](docs/verification.md)
- [Agent 정의](agent/payment-specialist.json), [Response Plan](agent/response-plan.json)
- [온보딩 대화](agent/onboarding-chat.md), [Live Reports 작성 대화](agent/live-report-chat.md)
- [운영 지식](agent/knowledge/service-context.md), [조사 Skill](agent/skills/payment-investigation/SKILL.md)
- [확인한 플랫폼 API와 공식 출처](docs/platform-api.md)

권장 환경은 `sredemolive`, 구독은 `aa3a0813-c921-4974-abb8-a0a68afd72a0`,
리전은 `eastus2`입니다. azd로 인프라·앱·SRE Agent 리소스·권한을 준비하고,
Agent 연결과 기능은 사용자가 직접 포털·채팅에서 구성합니다. 장애·복구는
스크립트로 제어하고 트래픽은 포털에서 확인합니다. 같은 Agent로 전체 시연을
진행하며 별도 presenter Agent를 만들지 않습니다. 이전 리허설 자원은 삭제됐습니다.

## A. 실행 환경

Node.js 22 이상, Azure CLI, Azure Developer CLI, kubectl, kubelogin이 필요합니다.
Azure 로그인 사용자에게 전용 RG 생성과 역할 할당 권한이 있어야 합니다.
GitHub Code Access에는 별도 GitHub 인증이 필요합니다. 비밀 값을 채팅·Git에 넣지 않습니다.

```bash
npm ci
npm test
npm run smoke:local
npm run verify
npm run verify:cloud -- --configured
```

로컬 API와 provider를 개별 터미널에서 실행할 수 있습니다.

```bash
npm start
npm run start:provider
```

## B. Azure 배포

```bash
az login --tenant 87c0e760-8b48-4301-a47d-a221b21bdee9
az account set --subscription aa3a0813-c921-4974-abb8-a0a68afd72a0
azd config set auth.useAzureCli true
azd env new sredemolive --subscription aa3a0813-c921-4974-abb8-a0a68afd72a0 --location eastus2
azd env set AZURE_PRINCIPAL_ID e69bc810-23c3-4656-8f38-9d7f098e0c90
azd env set ENABLE_INCIDENT_SCANNING true
azd provision --preview
azd provision
```

배포 사용자 ID는 이전 리허설의 로그인 사용자 기준입니다.
`az ad signed-in-user show --query id --output tsv`로 확인하고 다른 사용자로
로그인했다면 그 사용자의 실제 ID를 넣습니다.

환경 이름은 소문자·숫자·하이픈 3~16자로 지정합니다. 배포는 업무용 RG와 Agent용 RG,
2-node AKS Standard, ACR Standard, 두 LAW/App Insights, 실제 SRE Agent를 생성합니다.
새 테스트에는 `sredemokch14`와 다른 환경 이름을 사용합니다. 기존 로컬 azd 출력과
artifacts는 과거 기록이며, 삭제된 Agent·리소스의 연결값을 재사용하지 않습니다.
Log Analytics는 삭제 후 14일간 이름이 예약될 수 있습니다.
기본 VM은 Standard_D4s_v6입니다. 관련 자원은 유료이며 별도 쿼터·모델 사용료가 있습니다.
SRE Agent의 Stop은 상시 비용 종료와 다릅니다.

`ENABLE_INCIDENT_SCANNING=true`는 새 Agent UAMI에 구독 범위 Monitoring Contributor를
부여합니다. 사건 수집과 업무용 RG의 읽기 권한은 별개입니다. 고객 실서비스 범위로
그대로 확대하지 않습니다. 기본 SRE Agent 모드는 Review이며 workload Writer는 부여하지 않습니다.

postprovision hook은 ACR에서 v1.8/v1.9 이미지를 빌드하고 digest 고정으로 배치합니다.
로컬 Docker 데몬은 필요하지 않습니다. App Insights 연결 문자열은 stdin으로 Secret에
주입하며 출력하지 않습니다. 전용 kubeconfig와 실측 결과는 Git에서 제외된 artifacts에 저장됩니다.

로컬 배포 명령이 중단됐더라도 ARM 배포는 계속될 수 있습니다. 실제 완료 상태를 확인한
후 다음으로 출력을 복구하고 workload hook을 이어갑니다. 진행 중인 배포를 중복 생성하지 않습니다.

```bash
azd env refresh
node scripts/deploy.mjs
```

## C. SRE Agent 설정

사용자가 직접 포털·채팅에서 구성합니다. 화면별 값·지침·문서·Skill 본문은
[진행 가이드](docs/demo-guide.md#e-sre-agent-직접-구성)에 정리했습니다.
아래 API 도구는 내부 회귀 검증용이며 사용자 구성 절차에 사용하지 않습니다.

```bash
node scripts/agent.mjs status
node scripts/agent.mjs connect
node scripts/agent.mjs skill
node scripts/agent.mjs agent
node scripts/agent.mjs knowledge
node scripts/agent.mjs search
node scripts/agent.mjs incidents
node scripts/agent.mjs schedule
```

ARM 설정 변경은 비동기 재구성이므로 완료 상태를 기다립니다. 지식 업로드 이후에도
색인과 검색을 확인합니다. 초기 서비스 준비 중 색인 실패나 500이 관측될 수 있으므로
업로드 성공만으로 준비 완료라고 판단하지 않습니다. 예약 작업은 실제 Pause API와
`status: Paused`로 확인합니다. `isEnabled=false`만 보내는 방식은 사용하지 않습니다.

GitHub 저장소는 https://github.com/Kimcheolhui/Azure-SRE-Agent-Demo-Sample 입니다.
먼저 소스가 이 저장소에 게시되어 있어야 합니다. Builder의 Code Access에서 GitHub 인증을
완료하고 아래 등록·연결 시험을 진행합니다. GitHub CLI 로그인과 Agent의 Code Access 인증은
서로 다른 절차입니다. 게시 명령은 지정한 저장소만 대상으로 비밀 제외 검사를 거쳐
로컬 커밋을 만들고, 인증된 사용자의 명시적인 push 명령으로 게시합니다.

```bash
npm run publish:prepare
npm run publish:repo
```

게시 명령은 일반 `git push`와 Git의 기존 credential helper를 사용합니다. GitHub CLI
로그인은 필수가 아닙니다. 기존 Git 인증이 없을 때만 GitHub 로그인·인증을 준비합니다.

소스를 저장소에 게시한 뒤 이미지를 다시 빌드합니다. 인증이 없으면 로컬 커밋까지
준비할 수 있지만 원격 push는 수행하지 않습니다. 비밀번호·토큰은 채팅에 넣지 않습니다.

```bash
node scripts/agent.mjs repo
```

실제 `/version`의 sourceCommit과 저장소 SHA를 대조합니다. `unpublished`는 GitHub 대조가
아직 완료되지 않았다는 뜻입니다. Docker 빌드에는 v1.8의 app/src/provider-client.mjs 또는
v1.9의 app/releases/v1.9/provider-client.mjs가 동일 컨테이너 경로로 복사됩니다.
커밋만 아니라 릴리스별 빌드 입력도 함께 확인합니다.

GitHub 인증 전 대체 검증은 `node scripts/source-snapshot.mjs`로 가능합니다. 운영자가 실제
컨테이너에서 읽어 로컬 릴리스와 대조한 소스만 업로드합니다. 이것은 GitHub Code Access
성공이 아니며, 고객 시연 전에 원래 연결을 준비하는 것이 원칙입니다.

## D. 장애·복구

장애 발생·복구와 테스트 요청 생성은 스크립트로 수행합니다. 시연 중 트래픽·실패율·
지연·경고·조사 결과는 [진행 가이드의 포털 관측](docs/demo-guide.md#포털-관측)을
따라 포털에서 확인합니다.

```bash
unset DEMO_TARGET
azd env select sredemolive
node scripts/demo.mjs baseline
node scripts/demo.mjs incident
node scripts/demo.mjs recover
node scripts/demo.mjs check
node scripts/demo.mjs reset
node scripts/demo.mjs status
```

결제 요청 수는 baseline 40건(카드·계좌 각 20건), incident 23건(A·B·C 3건과
카드·계좌 각 10건), recover/check 43건(A·B·C 3건과 카드·계좌 각 20건)입니다.
`/version` 조회는 별도입니다. 일반 요청은 응답을 받은 뒤 다음 요청을 보내며,
장애·복구 격리 확인의 A/B만 의도적으로 겹쳐 실행하고 C는 두 응답 이후 실행합니다.
각 요청의 응답이 완료될 때 URL·HTTP 상태·소요 시간·결과·인스턴스·요청 ID를
터미널에 한 줄로 즉시 출력합니다. Pod 실행도 실시간으로 출력하며 마지막 집계와
실측 JSON 저장은 유지합니다.

기존 Pod를 바꾸지 않고 추가 트래픽만 보낼 수 있습니다.

```bash
node scripts/demo.mjs traffic-normal
node scripts/demo.mjs traffic-fail
```

`traffic-normal`은 stable v1.8, `traffic-fail`은 `incident`로 장애가 발생한 canary v1.9를
대상으로 카드·계좌 각 20건을 순차 전송합니다. Pod 교체·scale·재시작이나 경고 대기는
하지 않습니다. 이미지·준비 상태와 실제 응답을 검증하며, 기존 incident/recover 증거를
덮어쓰지 않고 `artifacts/traffic-normal.json`, `artifacts/traffic-fail.json`에 저장합니다.
실패 Pod가 자동 재시작되어 504가 나오지 않으면 오류로 알리며 새 장애를 주입하지 않습니다.
반복 요청이 새 자동 조사를 보장하지는 않습니다.

incident는 v1.9 canary를 새 Pod로 시작합니다. 같은 Pod 내부에서 A의 고비용 카드 서명
요청, A 시작 2.9초 후 B의 카드 요청, 그 뒤 C의 계좌 요청을 실행합니다. 실제 provider
PBKDF2 계산량으로 A가 3초 제한을 넘습니다. 결함 버전은 공유 signal 때문에 B·C도 실패합니다.
sleep/장애 모드/정답 로그를 서비스에 넣지 않습니다. 테스트용 CPU/타이머 대체는 test에만 있습니다.

복구는 canary를 v1.8 digest로 바꾸고 카드·계좌 각각 새 요청 20건의 실패 0건과
p95 <= 1,000ms를 검증합니다. Service port-forward는 전체 replica 부하 분산의 측정이
아니므로 결과의 clientLocation과 instance를 함께 읽습니다. API health 성공만으로 결제
성공을 판단하지 않습니다. incident는 이전 Fired 경고가 해제될 때까지 기다린 뒤
새 실행 시각·배포 digest·Agent·경고 ID를 기록합니다. recover는 경고 해제까지 확인하고,
check는 리소스를 변경하지 않고 최신 요청·격리·p95를 다시 측정합니다. 평가·해제 대기는
최대 15분이며 시간 초과 시 준비 완료로 처리하지 않습니다.

## E. 실제 대화·보고서

사용자는 [온보딩 채팅](agent/onboarding-chat.md)과
[Live Reports 작성 내용](agent/live-report-chat.md)을 포털에서 직접 입력합니다.
아래 명령은 내부 검증 도구 목록이며 이를 실행하는 방식으로 구성하지 않습니다.

```bash
node scripts/chat.mjs start onboarding-discovery
node scripts/chat.mjs await <THREAD_ID>
node scripts/chat.mjs follow <THREAD_ID> onboarding-context
node scripts/chat.mjs start onboarding-check
node scripts/chat.mjs start investigation
node scripts/features.mjs report-create
node scripts/features.mjs report-create <EXISTING_AUTHORING_THREAD_ID>
node scripts/features.mjs report-approve --reviewed <APPROVAL_ID>
node scripts/features.mjs report-status
node scripts/features.mjs report-verify
node scripts/features.mjs schedule-run
node scripts/features.mjs schedule-status
```

보고서 작성 스레드 생성 직후 초기 대화가 진행 중이면 메시지가 거부될 수 있습니다.
artifacts/native-report-authoring.json의 스레드 ID를 사용해 같은 스레드로 이어갑니다.
보고서는 네이티브 보고서 목록·버전·저장 HTML까지 확인합니다. 가이드 HTML과 다운로드된
정적 HTML은 Live Report가 아닙니다. 프롬프트는 Agent의 의미 판단을 보장하는 테스트가
아니므로 원시 쿼리·근거와 결과를 대조합니다.

보고서 승인 설명의 일부 문자열로 자동 승인하지 않습니다. 네이티브 카드에서 전체
도구·인자·대상을 검토한 뒤 정확한 승인 ID를 지정합니다. report-verify는 저장된 HTML의
실제 호출·쿼리를 파서로 추출해 같은 인자로 재조회하며, 외부 대상·다른 시간 범위·해석할
수 없는 동적 호출을 실패 처리합니다.

이 실제 환경에서 Paused 작업의 첫 수동 실행은 200초 서버 타임아웃이 관측됐고,
Active 상태로 전환한 수동 실행은 완료됐습니다. `schedule-run`은 다음 cron 시각과
충돌하지 않는지 확인하고 잠시 resume → execute → 최종 결과 확인 → finally pause를
수행합니다. 원인 일반화나 모든 테넌트에 대한 제한 주장으로 해석하지 않습니다.

SIGINT·SIGTERM도 Pause 완료를 기다립니다. 강제 종료나 Pause 오류 때 남은 복구 기록은
다음 기능 명령이 선택한 Agent와 작업을 확인하고 먼저 중지합니다.
resume 응답이 불확실하면 복구 기록을 유지하고 자동 재실행을 막습니다. 요청 취소가
서버 변경 취소를 보장하지 않으므로 네이티브 상태를 확인한 뒤 기록을 정리합니다.
수동 실행 결과는 기존 스레드가 아니라 제출 이후 새로 생성된 실행 ID·시각으로 선택합니다.

검증은 선택한 `DEMO_TARGET`을 사용합니다. 초기 상태와 구성 완료 상태를 혼동하지 않습니다.

```bash
DEMO_TARGET=presenter npm run verify:cloud -- --initial
DEMO_TARGET=presenter npm run verify:cloud -- --configured
npm run verify:cloud
```

기본 전체 검증은 1시간 이내의 현재 실행에 연결된 경고·계획·최종 조사·예약 결과와
현재 배포의 새 복구 측정을 요구합니다. 과거 성공 기록은 현장 준비 완료를 대신하지 않습니다.

## F. 정리

데모 뒤 먼저 반복 작업·Response Plan을 중지하고 서비스를 복구합니다. 필요한 실측과
원본 스레드를 보존한 뒤, 선택된 환경과 두 전용 RG를 확인하고 azd down을 실행합니다.

```bash
node scripts/demo.mjs recover
azd env get-values --output json
azd down
```

자동 삭제는 수행하지 않습니다. 구독 범위 사건 스캔 역할은 RG 삭제와 별도로 할당 ID를
확인해 이번 Agent에 추가한 항목만 회수해야 합니다. Agent 삭제 전 보고서·설정·지식의
보존 필요성을 확인합니다. 기존 샘플·기존 Agent·다른 리소스의 권한은 변경하지 않습니다.