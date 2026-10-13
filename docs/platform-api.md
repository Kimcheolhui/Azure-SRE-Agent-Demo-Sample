# Azure SRE Agent Platform APIs

Research date: 2026-10-13; focused public-source extension: 2026-10-14. Primary-source research only; no Azure authentication, resource/data-plane operations, deployments, commits, or pushes were performed. Examples below are source contracts for implementation, not runtime verification. Microsoft source snapshots: SRE templates `25a42306d298c4d28f11dd11ef9bb93cb0393be8`; MCP `901a192f9c493d7837e0c76051df31819e333a64`.

## A. Implementation Decision

Provision AKS, monitoring, identities, RBAC, and the **actual `Microsoft.App/agents` resource** through azd/Bicep. Then obtain the returned agent endpoint and apply runtime configuration through the documented REST interfaces or Azure MCP Server. Keep GitHub authentication and data-plane authorization as explicit setup gates. [api] [iac] [mcp]

**`sreagent_agents_create` creates a custom subagent inside an existing SRE Agent. It does not provision an ARM Agent resource.** The implementation calls `PUT /api/v2/extendedAgent/agents/{name}`. Resource list/get and subagent create/delete share the MCP `agents` command group but operate on different objects. [mcp] [mcp-service]

For this 30-minute demonstration, provision and verify before the customer session. Demonstrate the real payment failure, telemetry, deployed-code correlation, investigation, and report. A successful provisioning operation alone does not establish code access, log access, incident routing, or report readiness.

## B. ARM Resource Contract

### Versions and Required Fields

| Contract | Verified facts | Implementation consequence |
| --- | --- | --- |
| Published ARM Swagger and Bicep reference | `2026-01-01`; resource-group-scoped `Microsoft.App/agents`; PUT/GET/PATCH/DELETE and start/stop operations. | This is the current published schema, not evidence that every subscription supports every property. [arm-spec] [arm-template] |
| SRE API guide, official deployment templates, pinned MCP implementation | Use `2025-05-01-preview`. | The existing official automation recipes target this version. Pin it when adopting those recipes; do not silently upgrade their preview-only fields. [api] [core] [extras] [mcp-service] |
| Schema minimum | PUT requires the resource body, URL subscription/resource group/name, and inherited `location`. `identity` and `AgentProperties` configuration fields are not marked required in the published schema. | Schema optionality is not a proven service-side minimum for a usable agent. No empty-properties deployment was tested. [arm-spec] |
| Name | Pattern `^[A-Za-z]([-A-Za-z0-9]{0,30}[A-Za-z0-9])$`. | Starts with a letter; ends with an alphanumeric; 2-32 characters. [arm-spec] |

The published stable Swagger contains Agent and connector resource contracts, not the preview guide's skill/subagent/scheduled-task ARM child schemas. Do not assume every child type described for `2025-05-01-preview` exists at `2026-01-01`; use the separately verified runtime configuration interfaces below. [arm-spec] [api]

The exact configuration property is **`properties.logConfiguration.applicationInsightsConfiguration`**, containing `appId` and `connectionString`. Neither a top-level `appInsightsConfiguration` nor `networkConfiguration` is defined in the published `2026-01-01` Agent schema. [arm-spec]

Other published fields: `knowledgeGraphConfiguration.identity` and `.managedResources`; `actionConfiguration.identity`, `.mode`, `.accessLevel`; `incidentManagementConfiguration`; `defaultModel`; `upgradeChannel`; and optional `agentIdentity`/`agentSpaceId`. If `agentIdentity` is provided, `initialSponsorGroupId` is required; it is not the UAMI resource ID. Identity references in action/knowledge configuration are **ARM identity resource IDs**, not principal IDs. Managed resources in the official recipe are full resource-group IDs; listing them does not itself grant RBAC. [arm-spec] [core]

`2026-01-01` defines modes `Autonomous`, `Review`, `ReadOnly` and access levels `High`, `Low`. Older API prose/templates also use `Automatic`. Use `Review` for the demo; do not translate mode strings between versions without verification. [arm-spec] [api] [core]

### Small Practical Bicep Shape

This resource-group-scoped fragment uses existing UAMI and agent-telemetry Application Insights resources. It follows the **published `2026-01-01` schema**, with the identity/action/log arrangement corroborated by the official preview template. Provision the dependencies and role assignments separately. This is not a claim that these fields are all mandatory or that this version was live-tested. [arm-spec] [core]

```bicep
param agentName string
param location string
param identityName string
param agentAppInsightsName string
param managedResourceGroupIds array

resource agentIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: identityName
}

resource agentTelemetry 'Microsoft.Insights/components@2020-02-02' existing = {
  name: agentAppInsightsName
}

resource agent 'Microsoft.App/agents@2026-01-01' = {
  name: agentName
  location: location
  identity: {
    type: 'SystemAssigned,UserAssigned'
    userAssignedIdentities: {
      '${agentIdentity.id}': {}
    }
  }
  properties: {
    knowledgeGraphConfiguration: {
      identity: agentIdentity.id
      managedResources: managedResourceGroupIds
    }
    actionConfiguration: {
      identity: agentIdentity.id
      mode: 'Review'
      accessLevel: 'Low'
    }
    logConfiguration: {
      applicationInsightsConfiguration: {
        appId: agentTelemetry.properties.AppId
        connectionString: agentTelemetry.properties.ConnectionString
      }
    }
    upgradeChannel: 'Stable'
  }
}

output SRE_AGENT_RESOURCE_ID string = agent.id
output SRE_AGENT_ENDPOINT string = agent.properties.agentEndpoint
output SRE_AGENT_UAMI_RESOURCE_ID string = agentIdentity.id
output SRE_AGENT_UAMI_PRINCIPAL_ID string = agentIdentity.properties.principalId
```

For the official preview deployment path, start from [core] rather than adding undocumented properties to this fragment. That source uses `vnetConfiguration.subnetResourceId` and optional `sandboxConfiguration.egress` with `Unrestricted`, `Limited`, or `AzureVNet`, not `networkConfiguration`. The published stable schema does not expose those objects. Do not copy experimental feature flags or claim stable network support from this preview sample. Model selection also depends on subscription/region availability; query/select supported models instead of inventing a model value. [core] [arm-spec] [setup]

### Locations, Providers, and Identity

- Supported-region documentation lists both `eastus2` and `koreacentral`, among other regions. The subscription's Create agent region picker is the availability check; an empty list requires SRE subscription registration. Registering `Microsoft.App` alone does not prove SRE entitlement, regional capacity, or model availability. [regions] [setup]
- Check resource-provider registration for the types actually deployed: `Microsoft.App`, `Microsoft.ManagedIdentity`, `Microsoft.Insights`, `Microsoft.OperationalInsights`, plus `Microsoft.ContainerService` and `Microsoft.ContainerRegistry` for AKS/ACR. This is a resource-type-derived prerequisite list, not a sourced SRE-specific feature flag. Do not invent an `az feature register` feature name. [providers] [core]
- Creating the agent and assigning access requires Owner, or Contributor plus User Access Administrator at the relevant scopes. A resource-create permission does not imply role-assignment permission. [setup] [iac]
- ARM GET: `https://management.azure.com/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.App/agents/{agentName}?api-version={chosenVersion}`. Read `properties.agentEndpoint`; never construct a hostname from the name/region. The template's constructed endpoint output is weaker evidence than the returned value. [arm-spec] [api] [core] [extras]
- SAMI principal: `identity.principalId` on the Agent. Attached UAMIs: keys of `identity.userAssignedIdentities`; resolve the selected UAMI with ARM GET on its resource ID and read `properties.principalId`/`clientId`. When deploying your own UAMI, output its principal ID directly as above. Do not select the first identity if more than one is attached. [arm-spec] [identity-api] [extras]
- The current identity guide says to use UAMI for Azure access and connector selection, but its CLI example incorrectly targets `Microsoft.App/containerApps`. Official preview connector samples instead use `identity: 'system'` and grant the SAMI access. Select the identity deliberately and assign/query-test that same identity; do not silently grant both broad permissions. [identity] [extensions]

## C. Runtime REST and MCP Contracts

Paths below are relative to the **returned endpoint**, except ARM connectors. Runtime `/api/v1` and `/api/v2` are route versions; do not append ARM's `api-version` query to them. The API guide and pinned implementation are preview integration evidence, not a universal availability guarantee. [api] [mcp-service]

| Capability | Verified interface | Boundary / recommendation |
| --- | --- | --- |
| Custom subagent | `PUT /api/v2/extendedAgent/agents/{name}`; `sreagent_agents_create`. | Existing Agent required. Envelope `name`, `type: ExtendedAgent`, `properties`. Description is `handoffDescription`, not plain `description`. Configure real available tool names, not guessed identifiers. [subagent-model] [mcp-service] |
| Skill | `PUT /api/v2/extendedAgent/skills/{name}`; `sreagent_skills_create`. | Envelope `type: Skill`; instruction field `properties.skillContent`, not `content`. A skill is runtime instructions, not proof a diagnostic action executed. [skill-model] [mcp-service] |
| Knowledge upload | `POST /api/v1/AgentMemory/upload`; `sreagent_docs_memories_add`. | Multipart field **`files`**, supplied filename, part content type `text/markdown` in MCP. This uploads a knowledge document, not every conversational/past-session memory mechanism. [mcp-service] [memory] |
| Knowledge search/index | `GET /api/v1/AgentMemory/files`; `GET /api/v1/AgentMemory/documents?query={encodedQuery}&k={count}`; `POST /api/v1/AgentMemory/rebuildIndex`. | Source uses `AgentMemory`; API prose uses lowercase `agentmemory`. Preserve source spelling for the chosen implementation. Verify indexing/retrieval, not just upload success. [mcp-service] [api] |
| Azure resources/logs | ARM `knowledgeGraphConfiguration` + scoped RBAC; built-in Azure queries; optional persisted connectors. | Agent telemetry configuration is not a payment-service log connector. Built-in LAW/App Insights queries are possible with permissions even without a connector. [logs] [setup] |
| Persisted connectors | ARM `/agents/{agentName}/connectors/{connectorName}` with `2026-01-01` Swagger or `2025-05-01-preview` MCP/template path. | Schema properties: `dataConnectorType`, `dataSource`, `identity`, `extendedProperties`. Prefer this store over writing `/extendedAgent/connectors`: MCP source warns the latter is not visible on the portal Connectors page. [arm-spec] [extensions] [mcp-service] |
| Threads | `POST /api/v1/threads`; POST/GET `/api/v1/threads/{threadId}/messages`; corresponding MCP create/send/get. | Thread creation is not completed investigation. Follow messages/approval state; management PUTs are writes even when investigation mode is Review. [mcp-service] [mcp] |
| Incident platform | ARM PATCH of Agent `properties.incidentManagementConfiguration`. | Official extras script activates `type: AzMonitor`; this is separate from the Azure Monitor connector and Response Plan. [extras] |
| Response Plan | Official extras: `PUT /api/v2/extendedAgent/incidentFilters/{name}` with `type: IncidentFilter`. | Set `incidentPlatform: AzMonitor`, `handlingAgent`, `priorities`, `isEnabled`, `agentMode`; see example below. [extras] [azmon-recipe] |
| MCP incident plan | `sreagent_incidents_plans_create` uses `/api/v1/incidentplayground/filters/{id}`, `/handlers/{id}`, then filter enable. | Pinned code maps severities to **P1-P4** and sets `HandlingAgent = options.Agent` (the targeted resource name); no separate custom-handler argument. Do not use it as verified Sev0-Sev4 payment-subagent routing. [mcp-plan] |
| Scheduled task / Automation | MCP `POST /api/v1/scheduledtasks`; official extras `PUT /api/v2/extendedAgent/scheduledtasks/{name}` with `type: ScheduledTask`. | MCP v1 body: `name`, `agent`, `cronExpression`, `agentPrompt`, `description`. Official v2 normalization additionally sets `agentMode`, `isEnabled`. Do not assume MCP's resource selector configures the desired custom responder or exposes all portal fields. [schedule-model] [extras] |
| Live Reports | Documented creation through **Live Reports > New report**, authoring chat, saved gallery/version/Reload. | Native gallery/create/save/get request contracts remain unverified. The inspected public client is the outer shell, not the agent-hosted report UI; see section D's focused extension. A generic thread or local HTML is not proof of native report persistence. [reports] [api] [mcp-service] [sre-shell-client] |

Minimal runtime body shapes from the pinned MCP models:

```json
{
  "name": "payment-investigator",
  "type": "ExtendedAgent",
  "properties": {
    "handoffDescription": "Investigate payment errors and deployed provider-client code.",
    "instructions": "Correlate telemetry with the deployed commit. Identify shared AbortController lifetime. Do not modify workloads."
  }
}
```

```json
{
  "name": "payment-diagnostics",
  "type": "Skill",
  "properties": {
    "skillContent": "Correlate AbortError, instance, request timing, and deployed source before concluding a cause."
  }
}
```

The instruction strings above are demo-authored examples. The API names/fields are source-verified; these examples do not assert tools are inherited or that code access is already connected. [subagent-model] [skill-model]

## D. GitHub and Incident Automation

**GitHub Code Access is distinct from GitHub issue/PR connectors and a generic GitHub MCP connection.** Configuring the latter does not prove Code Access indexing or deployed-commit access. OAuth, PAT, and BYO GitHub App are documented; enterprise `<tenant>.ghe.com` requires BYO App, Key Vault private-key access, and GitHub installation permissions. Azure managed identity alone is not GitHub authorization. [github]

Code repo CRUD is documented at `/api/v2/repos/{repoName}`, with list/get/delete and POST `/{repoName}/test`. The official extras script uses an envelope with `name`, `type: CodeRepo`, and `properties.url`, `.type: GitHub`, optional `.branch`. Authentication must already be established. That script separately applies GitHub-domain authentication through `/api/v2/github/domains/{domain}`: its recipe path replaces dots with underscores, while a legacy PAT block uses literal `github.com`. These are observed script conventions, not a proven interchangeable host-encoding contract. Prefer the pinned official adapter or the portal; do not invent OAuth callbacks or guess host encodings. [api] [extras] [github-domain]

For noninteractive GitHub App setup the official spec fields are `authType: GitHubApp`, `clientId`, `privateKeySecretUri`, `keyVaultManagedIdentityId`. Private keys/PATs must stay out of the repository, azd outputs, command traces, screenshots, and customer-facing reports. Browser OAuth consent remains an interactive prerequisite when that path is selected. [github] [github-domain] [extras]

Azure Monitor activation in the official extras script is ARM PATCH, with this body shape:

```json
{
  "properties": {
    "incidentManagementConfiguration": {
      "type": "AzMonitor",
      "connectionName": "azmonitor",
      "connectionUrl": ""
    }
  }
}
```

Then apply a **separate** Response Plan to `/api/v2/extendedAgent/incidentFilters/{name}`. This example adapts the official recipe to a configured payment specialist and Review mode:

```json
{
  "name": "payment-alert-response",
  "type": "IncidentFilter",
  "tags": [],
  "properties": {
    "incidentPlatform": "AzMonitor",
    "isEnabled": true,
    "priorities": ["Sev1"],
    "handlingAgent": "payment-investigator",
    "agentMode": "Review"
  }
}
```

This minimal example routes all Sev1 Azure Monitor alerts. Add and verify payment-specific title/service filters in the documented Response Plan UI; do not claim this body isolates payment alerts. [extras] [azmon-recipe] [plans]

The scanner requires **Monitoring Contributor on the subscription**, checks every minute, and merges repeated firings of the same rule into an active thread. Resource-group diagnostic access and subscription alert-scan permission are different scopes. Ensure a real alert rule fires before promising automatic investigation. First incident-platform connection creates a quickstart response plan; remove/disable conflicting quickstart routing before demonstrating the payment plan. One incident platform is active at a time. [azmon] [plans] [extras]

Scheduled tasks can select a custom responder, autonomy, UTC cron schedule, dates/run limits, and thread grouping in the portal. The v2 adapter's fields are `name`, `description`, `cronExpression`, `agentPrompt`, `agent`, `agentMode`, `isEnabled`; obtain additional field contracts before automating run limits or grouping. Verify saved responder and execution thread, not only the task-create response. The demo's Automation requirement refers to SRE scheduled tasks, not a separate Azure Automation account; the cited tutorial calls the page **Scheduled tasks**. [extras] [schedules]

Live Reports require existing connector access and agent read/write permission. Refresh may use cached connector results for up to five minutes; Reload bypasses that cache. Model-assisted refresh consumes active-flow AAUs. A copied report link grants no access, and downloaded HTML is a static sanitized snapshot. Do not present a locally generated HTML report as a saved SRE Live Report. [reports]

### Run Now and Native Live Reports

**Current native-client verification, 2026-10-14.** Unauthenticated, cookie-free static GETs returned JavaScript `200` for the supplied agent's `index-Cv6Ar0r5.js`, `DataPlaneClient-CKKd8OiE.js`, `Middleware-B_4JVIWI.js`, `useAutomationData-BsZd49pu.js`, and public shell `main-CBdZpm2z.js`. Only four directly imported static dependencies were additionally read: `ScheduledTasks.styles-P8YQtr4x.js`, `AreaChart-aV8GUenp.js`, `headers-C5CILdnD.js`, and `QueryTriggers-Czlgr8Wt.js`, also unauthenticated `200`. Assets were inspected in memory; no credentials, cookies, authentication flow, or discovered API operation was used. Contracts below describe this deployed client, not a successful backend execution. Paths are relative to the agent endpoint. [native-index] [native-automation] [native-approval-client] [native-schedule-client] [native-headers] [sre-shell-client]

**Generic chat approval.** The owning client is `Ue.postApprovalDecision`, a class-field arrow method in `AreaChart-aV8GUenp.js` (export `ur`, imported as `uv` by the index). The index's `XBe` approval component supplies its `threadId` and **`approval.id`**, not the chat message ID. It sends HTTP, not a SignalR invocation: [native-approval-client] [native-index]

```http
POST /api/v1/approvals/{threadId}/{approvalId}/decision
Content-Type: application/json
```

The exact JSON keys are **`Status`, `User`, `Scope`, `ApproveScope`**. For approve-once of a `Pending` approval: `{"Status":"Approved","User":"<native userId>","ApproveScope":"none"}`. Add `Scope` with the approval's `oboTokenScope` when present; absent/undefined scope is omitted by JSON serialization. `User` comes from the native caller's `userIdAndDisplayName.userId`; do not substitute the approval ID or assume an ARM principal ID. `PendingAuthorization` uses `Status: "Authorized"`; denial uses `"Cancelled"`. `ApproveScope` is `"none"` for approve-once, `"thread"` or `"global"` for the corresponding broader UI choices. A supplied scope also becomes the **`x-sreagent-obo-scope`** header. This is distinct from `postExecutionAction` and report invoke-tool approval; the old `/approvals/{id}/approve` route is not this client's contract. [native-approval-client] [native-index] [native-headers]

The client returns the HTTP response body as its local `content`. The UI consumes `status`, `decisionMakerName`, `decisionMakerId`, legacy fallback `decisionMaker`, and `decisionTimestamp`; on HTTP `409`, it reads the existing decision and `expiredByTimeout` from the error response body. The local `{isSuccessful, content/error}` wrapper is **not** an HTTP response envelope. [native-approval-client] [native-index]

**Scheduled task Run now.** The owning client is class `Pg`, exported as `H` from `QueryTriggers-Czlgr8Wt.js`; `index` imports it as `vd`. The `SI` task card passes **`task.id`** to `runScheduledTask`, independently of pause/resume. [native-schedule-client] [native-index]

| Operation | Exact method and path | Body / response facts |
| --- | --- | --- |
| Identify runtime task | `GET /api/v1/scheduledtasks` | No body; native client consumes an array, including `id` and `status`. |
| Run once | `POST /api/v1/scheduledtasks/{taskId}/execute` | **No body**: the client passes `undefined`, not `{}`. `runScheduledTask` returns the raw response body as local `content`; the task card checks success but extracts no execution/thread ID. |
| Execution history | `GET /api/v1/scheduledtasks/{taskId}/executions` | No body; `getScheduledTaskExecutions` returns an array directly, not a `value` envelope. |

These are current native-client routes, not inferred MCP endpoints. Both execution methods use the shared JSON headers helper; no task-specific request DTO or SignalR invocation appears in these methods. [native-schedule-client] [native-headers]

The `_R` history mapper in `useAutomationData-BsZd49pu.js` reads **`executionTime`, `threadId`, `success`, `completed`, `errorMessage`, `durationMs`, `summary`, `artifacts`** from each execution. Use the new history entry's **`threadId`** for its execution chat; the task's configuration `threadId` instead controls same-thread grouping. No separate `runId`/`executionId` field is established by the inspected mapper, and the execute response's ID schema remains opaque. A history diff can identify new records, but cannot guarantee attribution to this call if a recurring/concurrent execution also occurs. [native-automation] [native-index]

**Remaining runtime boundary:** `runScheduledTask` sends only `/execute`, with no `/resume` or task update. This does not prove the backend accepts a paused task or preserves `Paused` after execution; neither was tested here. Preserve the owner-reported paused task and verify status separately when the authorized main agent executes it. Do not briefly resume recurrence to simulate Run now. [native-schedule-client]

**Native Live Reports remain unverified:** gallery list/get, report creation/authoring-thread initialization, save/version request DTOs, report-to-thread association fields, and report-specific header/context requirements. Neither the published API reference nor the pinned MCP service supplies them; the inspected outer-shell assets do not resolve them. Generic `POST /api/v1/threads` and message APIs do not establish the special authoring context or native gallery save contract. This is a bounded research result, not a claim that backend APIs do not exist. [api] [mcp-service] [sre-shell-client]

**Minimal documented native preparation procedure, when UI access becomes available:** [reports]

1. Open the agent's **Live Reports > + New report** with agent read/write permission and an already configured, healthy connector. Let the agent verify available tools.
2. Request a named payment-health report with an explicit time range, payment-service filter, and existing read-only connector. Review the proposed tools/arguments; do not approve workload changes.
3. Wait for the report to save and appear in the native gallery. Reopen it there, confirm **Open authoring thread** and saved versions, and use **Reload** for fresh connector data. Chat output or a generated/downloaded HTML file alone is not this verification.

**Native-report boundary:** the report-specific create/save DTOs were not researched in this approval/Run-now extension. The owner's existing native `SaveReport` approval is supplied context, not a report-save operation performed here. The generic approval contract above applies to its chat `approval.id`; it does not establish report invoke-tool approval or completed report persistence. [native-index] [native-approval-client]

## E. Authentication and Security Gates

- ARM uses the Azure management audience. The API guide and official extras script request data-plane tokens for **`https://azuresre.dev`**. Pinned MCP instead requests **`59f0a04a-b322-4310-adc9-39ac41e9631e/.default`**. Both are primary-source facts; their audience equivalence was not verified. Follow the chosen documented client path and test a harmless data-plane GET before any setup writes. [api] [extras] [mcp-service]
- Contributor/Owner control-plane success is not sufficient proof of data-plane access. Assign **SRE Agent Administrator on the Agent resource** to the actual setup caller. User/deployer, CI service principal, and agent managed identity are different principals. ARM service-principal/managed-identity support does not establish unattended data-plane token acquisition, tenant consent, or application-only authorization. Those remain environment validation gates. [api] [mcp] [setup]
- MCP authenticates with the host credential, not a newly granted identity. Pin tenant/subscription/credential selection when several identities exist. Reader is sufficient for discovery, not configuration writes. Standard investigation approval behavior does not make connector/subagent setup read-only; never use `investigate_yolo` for this demo. [mcp]
- Use scoped Reader/log-read roles for the workload. Container/pod logs require actual Kubernetes authorization as well as Azure access; Azure Reader is not a substitute for Kubernetes RBAC. Treat cluster-user credential access separately from in-cluster permissions. [aks-rbac]
- Agent telemetry App Insights and payment telemetry are separate purposes. If a connector explicitly uses SAMI, grant only that necessary scope or switch to a verified UAMI configuration; the official samples' broad dual-identity grants are not a least-privilege requirement. [core] [identity] [extensions]
- Require HTTPS, validate the discovered endpoint, respect network/private-DNS reachability, and keep tokens out of logs. Fail required demo setup when data-plane extras are skipped: the official adapter can finish ARM deployment and report skipped extras after token acquisition fails. [mcp] [extras]

## F. Minimal azd Provisioning Strategy

The azd schema requires `name` but makes `services` optional. For existing AKS manifests, use infrastructure provisioning plus a **root command** `postprovision` hook. Do not add a fake azd service solely to trigger manifest deployment. `azd provision` then performs infrastructure provisioning and this hook; there is no service package/deploy stage to rely on. [azd-schema] [azd-json] [azd-hooks] [azd-env]

```yaml
name: sre-agent-demo
infra:
  provider: bicep
  path: infra
  module: main
hooks:
  postprovision:
    posix:
      shell: sh
      run: bash ./scripts/postprovision.sh
      interactive: false
      continueOnError: false
```

This is an implementation example, not a file created by this research. The referenced script must exist before use. Explicit flags avoid relying on inconsistent interactive-default prose in the hooks guide. Root-hook working directory is the project root. [azd-hooks]

Standard `infra/main.parameters.json` shape; Bicep must declare matching parameter names:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "environmentName": { "value": "${AZURE_ENV_NAME}" },
    "location": { "value": "${AZURE_LOCATION}" },
    "principalId": { "value": "${AZURE_PRINCIPAL_ID}" }
  }
}
```

azd substitutes environment values and saves main Bicep outputs to `.azure/{environment}/.env`. Hooks receive those values automatically; `azd env get-values --output json` is the structured retrieval alternative. Do not `eval` untrusted environment output. `AZURE_PRINCIPAL_ID` identifies the running user/service principal, not the Agent UAMI. [azd-env]

For a subscription-scoped main deployment, create the resource group and invoke a resource-group-scoped module for the Agent/workload. Output `AZURE_RESOURCE_GROUP` explicitly. Also output actual AKS/ACR identifiers, workload telemetry identifiers, Agent ID, endpoint, and chosen UAMI principal. AKS/ACR variable names are project-owned conventions, not universal azd requirements. Do not output connection strings, PATs, private keys, or kubeconfig. [iac] [azd-env]

Recommended hook order: build/push the existing workload image, acquire a project-local kubeconfig for the intended cluster, apply existing manifests, wait for rollout and telemetry, discover Agent endpoint/identity, validate data-plane access, then apply subagent/skill/knowledge/code/incident/task configuration. This order is a demo design recommendation; azd does not automatically implement it. Make retries idempotent, pin the workload image/commit, fail on missing required configuration, and verify report persistence separately. Do not make a successful payment HTTP response the only readiness check for the shared-AbortController failure. [azd-hooks] [iac]

Before presenting, verify real concurrent/repeated payment failures, populated request/dependency/exception or container-log evidence, repository access to the deployed commit, payment-specific incident routing, and a saved Live Report. No such runtime checks were performed in this research.

## G. Primary Sources

[arm-spec]: https://github.com/Azure/azure-rest-api-specs/blob/main/specification/app/resource-manager/Microsoft.App/SreAgent/stable/2026-01-01/sreagent.json
[arm-template]: https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2026-01-01/agents
[api]: https://learn.microsoft.com/en-us/azure/sre-agent/api-reference
[iac]: https://learn.microsoft.com/en-us/azure/sre-agent/deploy-iac
[core]: https://github.com/microsoft/sre-agent/blob/25a42306d298c4d28f11dd11ef9bb93cb0393be8/sreagent-templates/bicep/agent-core.bicep
[extensions]: https://github.com/microsoft/sre-agent/blob/25a42306d298c4d28f11dd11ef9bb93cb0393be8/sreagent-templates/bicep/agent-extensions.bicep
[extras]: https://github.com/microsoft/sre-agent/blob/25a42306d298c4d28f11dd11ef9bb93cb0393be8/sreagent-templates/bicep/apply-extras.sh
[setup]: https://learn.microsoft.com/en-us/azure/sre-agent/create-and-set-up
[regions]: https://learn.microsoft.com/en-us/azure/sre-agent/supported-regions
[providers]: https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-providers-and-types
[identity]: https://learn.microsoft.com/en-us/azure/sre-agent/agent-identity
[identity-api]: https://learn.microsoft.com/en-us/rest/api/managedidentity/user-assigned-identities/get?view=rest-managedidentity-2024-11-30
[mcp]: https://learn.microsoft.com/en-us/azure/sre-agent/mcp-server
[mcp-service]: https://github.com/microsoft/mcp/blob/901a192f9c493d7837e0c76051df31819e333a64/tools/Azure.Mcp.Tools.SreAgent/src/Services/SreAgentService.cs
[subagent-model]: https://github.com/microsoft/mcp/blob/901a192f9c493d7837e0c76051df31819e333a64/tools/Azure.Mcp.Tools.SreAgent/src/Models/SreSubAgentProperties.cs
[skill-model]: https://github.com/microsoft/mcp/blob/901a192f9c493d7837e0c76051df31819e333a64/tools/Azure.Mcp.Tools.SreAgent/src/Models/SreSkillProperties.cs
[schedule-model]: https://github.com/microsoft/mcp/blob/901a192f9c493d7837e0c76051df31819e333a64/tools/Azure.Mcp.Tools.SreAgent/src/Models/SreAgentScheduledTaskModels.cs
[mcp-plan]: https://github.com/microsoft/mcp/blob/901a192f9c493d7837e0c76051df31819e333a64/tools/Azure.Mcp.Tools.SreAgent/src/Commands/Incidents/IncidentsPlansCreateCommand.cs
[memory]: https://learn.microsoft.com/en-us/azure/sre-agent/memory
[logs]: https://learn.microsoft.com/en-us/azure/sre-agent/log-analytics-app-insights
[github]: https://learn.microsoft.com/en-us/azure/sre-agent/github-connector
[github-domain]: https://github.com/microsoft/sre-agent/blob/25a42306d298c4d28f11dd11ef9bb93cb0393be8/sreagent-templates/recipes/azmon-lawappinsights/config/github-domains/github-com.yaml
[azmon-recipe]: https://github.com/microsoft/sre-agent/blob/25a42306d298c4d28f11dd11ef9bb93cb0393be8/sreagent-templates/recipes/azmon-lawappinsights/automations/incident-filters/azmon-sev01.yaml
[azmon]: https://learn.microsoft.com/en-us/azure/sre-agent/azure-monitor-alerts
[plans]: https://learn.microsoft.com/en-us/azure/sre-agent/incident-response-plans
[schedules]: https://learn.microsoft.com/en-us/azure/sre-agent/create-scheduled-task
[reports]: https://learn.microsoft.com/en-us/azure/sre-agent/live-reports
[aks-rbac]: https://learn.microsoft.com/en-us/azure/aks/manage-azure-rbac
[azd-schema]: https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/azd-schema
[azd-json]: https://github.com/Azure/azure-dev/blob/main/schemas/v1.0/azure.yaml.json
[azd-hooks]: https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/azd-extensibility
[azd-env]: https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/manage-environment-variables
[sre-shell-page]: https://sre.azure.com/
[sre-shell-client]: https://sre.azure.com/assets/main-CBdZpm2z.js
[sre-shell-shared]: https://sre.azure.com/assets/CacheKeys-Csjlptm3.js
[sre-public-source]: https://github.com/microsoft/sre-agent/tree/25a42306d298c4d28f11dd11ef9bb93cb0393be8
[native-index]: https://sre-sredemokch14--1cbb24db.20f90e72.eastus2.azuresre.ai/static/assets/index-Cv6Ar0r5.js
[native-approval-client]: https://sre-sredemokch14--1cbb24db.20f90e72.eastus2.azuresre.ai/static/assets/AreaChart-aV8GUenp.js
[native-schedule-client]: https://sre-sredemokch14--1cbb24db.20f90e72.eastus2.azuresre.ai/static/assets/QueryTriggers-Czlgr8Wt.js
[native-automation]: https://sre-sredemokch14--1cbb24db.20f90e72.eastus2.azuresre.ai/static/assets/useAutomationData-BsZd49pu.js
[native-headers]: https://sre-sredemokch14--1cbb24db.20f90e72.eastus2.azuresre.ai/static/assets/headers-C5CILdnD.js