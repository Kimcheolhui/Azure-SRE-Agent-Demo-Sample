---
name: payment-investigation
description: Investigate payment errors, latency or instance-specific failures by correlating requests, dependencies, logs and deployed source.
---

# Payment Investigation

1. Confirm the actual resource group, AKS cluster, namespace and UTC investigation window.
2. Compare failure rate and p95 for card/bank, instance and deployed release. Separate process health from payment success.
3. Correlate request IDs, trace IDs, exceptions, dependency duration and container logs within the same time window.
4. Verify the Deployment image, Pod imageID and source revision. Read the matching provider-call implementation, not just repository HEAD.
5. Compare at least two plausible explanations using supporting and contradicting evidence. Trace object lifetime, request timing and network/CPU behavior where evidence warrants it.
6. Identify unavailable data and failed queries explicitly. Do not interpret an empty result as a healthy service.
7. Report root cause or remaining hypotheses, impact, query/source references, minimal mitigation and recovery conditions.
8. Do not change resources, retrieve secrets or retry payments during investigation.
9. Recovery requires fresh card/bank requests with zero failures and p95 <= 1,000 ms over 20 paired rounds, plus concurrent-request isolation when investigating timeout propagation.