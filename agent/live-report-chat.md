# Live Reports Authoring Chat

Open **Live Reports**, create a new report, and use this prompt. A normal chat
request is not proof that a report was saved in the gallery.

```text
Payments Service Live Report를 만들어 주세요. 연결된 업무용 Log Analytics/Application Insights에서 최근 30분의 payment-api 데이터를 조회해 결제 수단별 요청 수·실패율·p95, release와 인스턴스별 오류, 분당 504 추이를 보여 주세요. 조회 대상 리소스와 UTC 구간·갱신 시각을 표시하고, 정상 기준인 실패 0건과 p95 1,000ms 이하와 비교해 주세요. 데이터가 없으면 0이나 정상으로 표시하지 말고 미확인으로 표시하세요. 리소스를 변경하는 액션은 넣지 마세요.
```

Verify the report is saved in the gallery, reopen it, and check each displayed
measure against the KQL files in `queries/`. Use Reload to verify current data.
Do not call a static downloaded HTML snapshot a live report. Cache behavior and
refresh consumption are governed by the real service.