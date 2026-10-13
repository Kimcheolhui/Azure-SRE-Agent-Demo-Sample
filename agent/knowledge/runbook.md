# Payments Operations Runbook

## Investigation

- Compare method-, release- and instance-specific request failures and latency.
- Match failing request records to exceptions, provider dependencies and container logs.
- Compare the incident window with Deployment revisions, image IDs and audit events.
- Inspect actual deployed source for the failing call path. Keep competing explanations until evidence discriminates them.
- Separate the cause of an initially slow request from the cause of subsequent failures.

## Change Control

Investigation does not authorize resource or code changes. Propose the smallest
reversible change, its target, risk and verification conditions. Do not retrieve
Kubernetes Secrets or credentials. Restrict this demo to the dedicated workload.

## Recovery

Fresh card and bank requests must succeed with zero failures over 20 paired
rounds and p95 <= 1,000 ms. Verify concurrent and subsequent requests independently
when reviewing a timeout-related defect. Query the post-recovery UTC interval;
older failures remain in telemetry. Record alert resolution separately from fresh
request success.