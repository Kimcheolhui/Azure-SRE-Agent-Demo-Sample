# Payments Service

## Architecture

The dedicated demo workload uses namespace `payments` on AKS. `payment-api`
receives GET `/pay?method=card|bank&amount=<number>` and sends POST `/authorize`
to `payment-provider`. The provider computes card authorization signatures using
PBKDF2 and bank signatures using SHA-256. It does not contact a bank or persist
orders/settlements. A valid `signatureIterations` value changes card signature
work factor; it is not a sleep or scenario switch.

Stable API instances and a separately deployed canary may use different images.
The API's `/version` returns release, source revision and instance. Requests,
dependency calls, errors and container logs carry correlation fields. Kubernetes
audit and application telemetry are separate data sources.

## Normal Criteria

Twenty fresh requests per payment method must have zero failures and p95 <=
1,000 ms. A deliberately high-work-factor card request may exceed the API's
3-second provider deadline. That timeout must be isolated to that request.
Concurrent normal requests and later normal requests must still succeed.
Successful `/health`, Pod Ready and rollout status alone are insufficient.

## Ownership and Constraints

The Payments demo team owns API and provider. SRE Agent investigates with
read-only workload access. The operator applies approved changes outside the
investigation. No real customer, bank, credit-card or settlement data is present.
For production systems, never retry a timed-out payment before verifying the
external approval state and duplicate-processing guarantees.

## Evidence

Fix resource, namespace, UTC window, request/trace IDs, instance and actual
image/source revision before comparing data. An environment rollout is not proof
of a code change. If the source revision is `unpublished`, GitHub deployed-commit
correlation has not been established; report that limitation explicitly.