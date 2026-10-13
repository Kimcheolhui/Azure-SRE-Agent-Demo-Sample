# Team Onboarding Chat

## 1. Start Discovery

```text
우리 Payments 팀의 서비스 온보딩을 진행해 주세요. 연결된 Azure 리소스와 GitHub 저장소에서 서비스 구조·호출 관계·배포 구성을 탐색하고, 확인한 사실과 추가로 필요한 정보를 구분해 주세요. 이 단계에서는 리소스를 변경하지 마세요.
```

## 2. Add Team Context

```text
Payments demo 팀은 payments namespace의 payment-api와 payment-provider를 담당합니다. API는 카드와 계좌 결제 요청을 받아 provider의 승인 API를 호출합니다. provider는 실습용 서명 계산 서비스이며 실제 은행·고객 데이터·주문 DB는 없습니다. 이 환경은 고객 데모용이며 운영 환경과 분리되어 있습니다.
```

## 3. Add Normal and Timeout Criteria

```text
정상 기준은 카드와 계좌 각각 새 요청 20건에서 실패 0건, p95 1,000ms 이하입니다. provider 호출의 기본 제한은 3초입니다. 일부 카드 요청의 서명 계산량이 크면 제한을 넘을 수 있지만, 해당 요청의 실패가 동시에 실행 중인 다른 요청이나 이후 요청으로 전파되면 안 됩니다. Pod Ready나 /health 성공만으로 결제 정상이라고 판단하지 마세요.
```

## 4. Confirm Persisted Knowledge

```text
지금까지 확인한 서비스 구조·담당 범위·정상 기준·조사 주의사항을 팀 지식으로 정리해 주세요. 저장한 파일과 출처를 알려 주고, 코드·리소스에서 직접 확인한 내용과 내가 제공한 설명을 구분해 주세요.
```

## 5. Verify in a New Conversation

```text
Payments 서비스는 어떤 구성요소를 거치며, 어떤 조건을 만족해야 정상이라고 판단하나요? 팀 지식의 출처를 함께 알려 주세요. 실제로 확인하지 못한 내용은 추정하지 마세요.
```