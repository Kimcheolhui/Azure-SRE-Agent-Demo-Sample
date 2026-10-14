import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyPresenterTarget,
  deploymentOutputs,
  validateTarget,
  validateOwnership,
  validateRelease,
  runStreaming,
} from "../scripts/cloud.mjs";
import { selectTrafficPod, runTrafficOnly } from "../scripts/traffic-only.mjs";

test('presenter selection keeps the same workload and rejects foreign Agent targets', () => {
  const values = { AZURE_ENV_NAME: 'demo', AZURE_SUBSCRIPTION_ID: 'subscription', AGENT_RESOURCE_GROUP: 'rg-demo-agent', AZURE_RESOURCE_GROUP: 'rg-demo-workload' };
  const target = { SRE_AGENT_NAME: 'sre-demo-presenter', SRE_AGENT_RESOURCE_ID: '/subscriptions/subscription/resourceGroups/rg-demo-agent/providers/Microsoft.App/agents/sre-demo-presenter', SRE_AGENT_ENDPOINT: 'https://presenter.azuresre.ai' };
  assert.equal(applyPresenterTarget(values, target).AZURE_RESOURCE_GROUP, 'rg-demo-workload');
  assert.equal(applyPresenterTarget(values, { ...target, AZURE_RESOURCE_GROUP: 'foreign-workload' }).AZURE_RESOURCE_GROUP, 'rg-demo-workload');
  assert.throws(() => applyPresenterTarget(values, { ...target, SRE_AGENT_NAME: 'unrelated-agent' }), /dedicated environment/);
  assert.throws(() => applyPresenterTarget(values, { ...target, SRE_AGENT_RESOURCE_ID: '/subscriptions/other/agents/example' }), /dedicated environment/);
});

test('Azure CLI camel-cased deployment output names map to azd conventions', () => {
  assert.deepEqual(deploymentOutputs({ srE_AGENT_NAME: { value: 'sre-demo-presenter' }, srE_AGENT_PRINCIPAL_ID: { value: 'principal' } }), { SRE_AGENT_NAME: 'sre-demo-presenter', SRE_AGENT_PRINCIPAL_ID: 'principal' });
});

function ownedFixture() {
  const subscription = '00000000-0000-0000-0000-000000000001';
  const base = `/subscriptions/${subscription}/resourceGroups/`;
  const values = { AZURE_SUBSCRIPTION_ID: subscription, AZURE_ENV_NAME: 'demo', AZURE_RESOURCE_GROUP: 'rg-demo-workload', AGENT_RESOURCE_GROUP: 'rg-demo-agent', AZURE_AKS_CLUSTER_NAME: 'aks-demo', SRE_AGENT_NAME: 'sre-demo', SRE_AGENT_RESOURCE_ID: `${base}rg-demo-agent/providers/Microsoft.App/agents/sre-demo`, SRE_AGENT_ENDPOINT: 'https://demo.azuresre.ai', AZURE_CONTAINER_REGISTRY_NAME: 'acrsredemoexample', AZURE_CONTAINER_REGISTRY_ENDPOINT: 'acrsredemoexample.azurecr.io' };
  const tags = { purpose: 'sre-customer-demo', 'azd-env-name': 'demo' };
  const resources = { workloadGroup: { id: `${base}rg-demo-workload`, tags }, agentGroup: { id: `${base}rg-demo-agent`, tags }, cluster: { id: `${base}rg-demo-workload/providers/Microsoft.ContainerService/managedClusters/aks-demo` }, registry: { id: `${base}rg-demo-workload/providers/Microsoft.ContainerRegistry/registries/acrsredemoexample`, loginServer: values.AZURE_CONTAINER_REGISTRY_ENDPOINT }, agent: { id: values.SRE_AGENT_RESOURCE_ID, tags, endpoint: values.SRE_AGENT_ENDPOINT } };
  return { values, resources };
}
test('production-like names and foreign ARM IDs cannot pass demo target validation', () => {
  const { values } = ownedFixture();
  assert.equal(validateTarget(values), values);
  assert.throws(() => validateTarget({ ...values, AZURE_RESOURCE_GROUP: 'rg-production-payments' }), /mismatch/);
  assert.throws(() => validateTarget({ ...values, AZURE_AKS_CLUSTER_NAME: 'aks-production-payments' }), /mismatch/);
  assert.throws(() => validateTarget({ ...values, SRE_AGENT_RESOURCE_ID: values.SRE_AGENT_RESOURCE_ID.replace('000000000001', '000000000002') }), /mismatch/);
});
test('ownership and actual endpoint are verified before workload mutations', () => {
  const { values, resources } = ownedFixture();
  assert.equal(validateOwnership(values, resources), values);
  assert.throws(() => validateOwnership(values, { ...resources, workloadGroup: { ...resources.workloadGroup, tags: {} } }), /Unowned/);
  assert.throws(() => validateOwnership(values, { ...resources, cluster: { id: '/subscriptions/other/cluster' } }), /Foreign/);
  assert.throws(() => validateOwnership(values, { ...resources, agent: { ...resources.agent, endpoint: 'https://other.azuresre.ai' } }), /mismatch/);
});
test('release evidence is bound to subscription, workload and registry digest', () => {
  const { values } = ownedFixture();
  const image = `${values.AZURE_CONTAINER_REGISTRY_ENDPOINT}/payment-api@sha256:${'a'.repeat(64)}`;
  const release = { subscription: values.AZURE_SUBSCRIPTION_ID, resourceGroup: values.AZURE_RESOURCE_GROUP, cluster: values.AZURE_AKS_CLUSTER_NAME, images: { 'v1.8': image, 'v1.9': image } };
  assert.equal(validateRelease(values, release), release);
  assert.throws(() => validateRelease(values, { ...release, subscription: 'other' }), /subscription/);
  assert.throws(() => validateRelease(values, { ...release, images: { ...release.images, 'v1.9': 'foreign.azurecr.io/image@sha256:' + 'a'.repeat(64) } }), /selected demo registry/);
});
function trafficFixture(action) {
  const image = (version) =>
    `acrsredemoexample.azurecr.io/payment-api@sha256:${(version === "v1.8" ? "a" : "b").repeat(64)}`;
  const release = { images: { "v1.8": image("v1.8"), "v1.9": image("v1.9") } };
  const normal = action === "traffic-normal";
  const version = normal ? "v1.8" : "v1.9";
  const deployment = {
    metadata: {
      name: normal ? "payment-api" : "payment-api-canary",
      namespace: "payments",
    },
    spec: {
      replicas: 1,
      template: {
        spec: { containers: [{ name: "payment-api", image: image(version) }] },
      },
    },
  };
  const pod = {
    metadata: {
      name: "existing-payment-pod",
      namespace: "payments",
      creationTimestamp: "2026-10-14T00:00:00Z",
      labels: { app: "payment-api", track: normal ? "stable" : "canary" },
    },
    spec: { containers: [{ name: "payment-api", image: image(version) }] },
    status: {
      phase: "Running",
      containerStatuses: [
        { name: "payment-api", ready: true, imageID: image(version) },
      ],
    },
  };
  return { release, deployment, pod, pods: { items: [pod] }, version };
}

test("traffic-only Pod programs produce forty sequential normal or failed response lines", async () => {
  for (const action of ["traffic-normal", "traffic-fail"]) {
    const fixture = trafficFixture(action);
    let progress = "";
    const status = action === "traffic-normal" ? 200 : 504;
    const response = { release: fixture.version, instance: fixture.pod.metadata.name, ...(status === 200 ? { approved: true } : { error: "authorization_timeout" }) };
    const result = await runTrafficOnly(action, "test-kubeconfig", fixture.release, {
      read: (filename, args) => JSON.stringify(args[3] === "deployment" ? fixture.deployment : fixture.pods),
      execute: async (command, args, options) => runStreaming(process.execPath, ["--input-type=module"], {
        input: `globalThis.fetch=async url=>new Response(JSON.stringify(${JSON.stringify(response)}),{status:String(url).endsWith('/version')?200:${status}});\n${options.input}`,
        onStderr: chunk => { progress += chunk; }
      })
    });
    assert.equal(result.results.length, 40);
    const lines = progress.trim().split("\n");
    assert.equal(lines.length, 40);
    assert(lines.every(line => line.includes(`HTTP ${status}`)));
    assert(lines[0].startsWith(`[${action} 1/40] GET /pay?method=card`));
    assert(lines[39].startsWith(`[${action} 40/40] GET /pay?method=bank`));
  }
});

test("traffic-only Pod program rejects a mismatched running release before sending payments", async () => {
  const fixture = trafficFixture("traffic-normal");
  let progress = "";
  await assert.rejects(runTrafficOnly("traffic-normal", "test-kubeconfig", fixture.release, {
    read: (filename, args) => JSON.stringify(args[3] === "deployment" ? fixture.deployment : fixture.pods),
    execute: async (command, args, options) => runStreaming(process.execPath, ["--input-type=module"], {
      input: `globalThis.fetch=async()=>new Response(JSON.stringify({release:'v1.9'}));\n${options.input}`,
      onStderr: chunk => { progress += chunk; }
    })
  }), /exited 1/);
  assert(progress.includes("Running release does not match"));
  assert(!progress.includes("GET /pay?"));
});

test("traffic-only selects the existing healthy or failed Pod and rejects wrong images, tracks and readiness", () => {
  for (const action of ["traffic-normal", "traffic-fail"]) {
    const { release, deployment, pod, pods, version } = trafficFixture(action);
    assert.equal(selectTrafficPod(action, release, deployment, pods).pod, pod);
    assert.equal(
      selectTrafficPod(action, release, deployment, pods).expectedRelease,
      version,
    );
    const otherImage = release.images[version === "v1.8" ? "v1.9" : "v1.8"];
    assert.throws(
      () =>
        selectTrafficPod(
          action,
          release,
          {
            ...deployment,
            spec: {
              ...deployment.spec,
              template: {
                spec: {
                  containers: [{ name: "payment-api", image: otherImage }],
                },
              },
            },
          },
          pods,
        ),
      /Expected .* image/,
    );
    assert.throws(
      () =>
        selectTrafficPod(
          action,
          release,
          { ...deployment, spec: { ...deployment.spec, replicas: 0 } },
          pods,
        ),
      /no replicas/,
    );
    assert.throws(
      () =>
        selectTrafficPod(action, release, deployment, {
          items: [
            {
              ...pod,
              spec: {
                containers: [{ name: "payment-api", image: otherImage }],
              },
            },
          ],
        }),
      /No ready/,
    );
    assert.throws(
      () =>
        selectTrafficPod(action, release, deployment, {
          items: [
            {
              ...pod,
              metadata: {
                ...pod.metadata,
                labels: { app: "payment-api", track: "other" },
              },
            },
          ],
        }),
      /No ready/,
    );
    assert.throws(
      () =>
        selectTrafficPod(action, release, deployment, {
          items: [{ ...pod, status: { ...pod.status, phase: "Pending" } }],
        }),
      /No ready/,
    );
    assert.throws(
      () =>
        selectTrafficPod(action, release, deployment, {
          items: [
            {
              ...pod,
              metadata: {
                ...pod.metadata,
                deletionTimestamp: "2026-10-14T01:00:00Z",
              },
            },
          ],
        }),
      /No ready/,
    );
  }
});

test("traffic-only performs reads and existing-Pod exec without rollout or alert operations", async () => {
  for (const action of ["traffic-normal", "traffic-fail"]) {
    const fixture = trafficFixture(action);
    const calls = [];
    const read = (filename, args) => {
      assert.equal(filename, "test-kubeconfig");
      calls.push(args);
      assert.equal(args[2], "get");
      return JSON.stringify(
        args[3] === "deployment" ? fixture.deployment : fixture.pods,
      );
    };
    const execute = async (command, args, options) => {
      assert.equal(command, "kubectl");
      calls.push(args);
      assert(args.includes(fixture.pod.metadata.name));
      assert(options.input.includes("healthyTraffic(baseUrl,20,"));
      assert(!options.input.includes("await cascadeTraffic("));
      assert(
        options.input.includes(
          `version.release!==${JSON.stringify(fixture.version)}`,
        ),
      );
      return JSON.stringify({
        version: { release: fixture.version },
        results: Array.from({ length: 40 }, (_, index) => ({
          method: index % 2 ? "bank" : "card",
          status: action === "traffic-normal" ? 200 : 504,
          elapsedMs: 10,
        })),
      });
    };
    const result = await runTrafficOnly(
      action,
      "test-kubeconfig",
      fixture.release,
      { read, execute },
    );
    assert.equal(result.results.length, 40);
    assert.equal(result.clientLocation, fixture.pod.metadata.name);
    assert.equal(calls.length, 3);
    assert(
      !calls
        .flat()
        .some((value) =>
          ["set", "scale", "rollout", "restart", "patch", "apply"].includes(
            value,
          ),
        ),
    );
  }
});

test("failed traffic refuses a healthy target before executing requests", async () => {
  const fixture = trafficFixture("traffic-fail");
  fixture.deployment.spec.template.spec.containers[0].image =
    fixture.release.images["v1.8"];
  let executed = false;
  await assert.rejects(
    runTrafficOnly("traffic-fail", "test-kubeconfig", fixture.release, {
      read: (filename, args) =>
        JSON.stringify(
          args[3] === "deployment" ? fixture.deployment : fixture.pods,
        ),
      execute: async () => {
        executed = true;
      },
    }),
    /Expected v1.9 image/,
  );
  assert.equal(executed, false);
});

test("failed traffic reports when the existing Pod no longer produces 504 responses", async () => {
  const fixture = trafficFixture("traffic-fail");
  await assert.rejects(
    runTrafficOnly("traffic-fail", "test-kubeconfig", fixture.release, {
      read: (filename, args) =>
        JSON.stringify(
          args[3] === "deployment" ? fixture.deployment : fixture.pods,
        ),
      execute: async () =>
        JSON.stringify({
          version: { release: fixture.version },
          results: Array.from({ length: 40 }, (_, index) => ({
            method: index % 2 ? "bank" : "card",
            status: 200,
            elapsedMs: 10,
          })),
        }),
    }),
    /Expected existing failure state/,
  );
});
