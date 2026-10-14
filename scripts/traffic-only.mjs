import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { root, kubectl, runStreaming } from "./cloud.mjs";
import { summarize } from "./traffic.mjs";

export function selectTrafficPod(action, release, deployment, pods) {
  assert(
    ["traffic-normal", "traffic-fail"].includes(action),
    "Invalid traffic-only action",
  );
  const expectedRelease = action === "traffic-normal" ? "v1.8" : "v1.9";
  const deploymentName =
    action === "traffic-normal" ? "payment-api" : "payment-api-canary";
  const track = action === "traffic-normal" ? "stable" : "canary";
  const image = release.images?.[expectedRelease];
  assert(
    image && /@sha256:[a-f0-9]{64}$/.test(image),
    "Missing pinned traffic image",
  );
  assert(
    deployment.metadata?.name === deploymentName &&
      deployment.metadata?.namespace === "payments",
    "Wrong traffic Deployment",
  );
    assert(
      deployment.spec?.template?.spec?.containers?.find(
        (container) => container.name === "payment-api",
      )?.image === image,
      `Expected ${expectedRelease} image for ${action}; no deployment changes will be made`,
    );
  assert(
    (deployment.spec.replicas ?? 1) > 0,
    "Traffic Deployment has no replicas; do not scale it automatically",
  );
  const pod = pods.items
    ?.filter(
      (item) =>
        !item.metadata?.deletionTimestamp &&
        item.metadata?.namespace === "payments" &&
        item.metadata?.labels?.app === "payment-api" &&
        item.metadata?.labels?.track === track &&
        item.status?.phase === "Running" &&
        item.status?.containerStatuses?.find(
          (container) => container.name === "payment-api",
        )?.ready === true &&
        item.spec?.containers?.find(
          (container) => container.name === "payment-api",
        )?.image === image,
    )
    .sort((left, right) =>
      (right.metadata.creationTimestamp || "").localeCompare(
        left.metadata.creationTimestamp || "",
      ),
    )[0];
  assert(
    pod,
    `No ready ${track} Pod with the expected image; do not restart it automatically`,
  );
  return { pod, expectedRelease };
}

export async function runTrafficOnly(
  action,
  filename,
  release,
  { read = kubectl, execute = runStreaming } = {},
) {
  assert(
    ["traffic-normal", "traffic-fail"].includes(action),
    "Invalid traffic-only action",
  );
  const deploymentName =
    action === "traffic-normal" ? "payment-api" : "payment-api-canary";
  const track = action === "traffic-normal" ? "stable" : "canary";
  const deployment = JSON.parse(
    read(filename, [
      "-n",
      "payments",
      "get",
      "deployment",
      deploymentName,
      "-o",
      "json",
    ]),
  );
  const pods = JSON.parse(
    read(filename, [
      "-n",
      "payments",
      "get",
      "pods",
      "-l",
      `app=payment-api,track=${track}`,
      "-o",
      "json",
    ]),
  );
  const { pod, expectedRelease } = selectTrafficPod(
    action,
    release,
    deployment,
    pods,
  );
  const trafficSource = await readFile(
    path.join(root, "scripts/traffic.mjs"),
    "utf8",
  );
  const program = `${trafficSource}\nconst baseUrl='http://127.0.0.1:8080';\nconst version=await(await fetch(baseUrl+'/version')).json();\nif(version.release!==${JSON.stringify(expectedRelease)})throw new Error('Running release does not match the traffic target');\nconst results=await healthyTraffic(baseUrl,20,createTrafficLogger(${JSON.stringify(action)},40,line=>console.error(line)));\nconsole.log(JSON.stringify({version,results}));`;
  const { version, results } = JSON.parse(
    await execute(
      "kubectl",
      [
        "--kubeconfig",
        filename,
        "-n",
        "payments",
        "exec",
        "-i",
        pod.metadata.name,
        "--",
        "node",
        "--input-type=module",
      ],
      { input: program, onStderr: (chunk) => process.stdout.write(chunk) },
    ),
  );
  assert.equal(
    version.release,
    expectedRelease,
    "Running release does not match the traffic target",
  );
  assert.equal(results.length, 40, "Expected forty payment requests");
  const expectedStatus = action === "traffic-normal" ? 200 : 504;
  for (const result of results)
    assert.equal(
      result.status,
      expectedStatus,
      action === "traffic-fail"
        ? "Expected existing failure state; this command does not inject a new fault"
        : "Expected a successful payment response",
    );
  const summary = summarize(results);
  assert.equal(summary.length, 2);
  for (const method of ["card", "bank"])
    assert.equal(summary.find((item) => item.group === method)?.requests, 20);
  return {
    version,
    results,
    summary,
    clientLocation: pod.metadata.name,
    imageID: pod.status.containerStatuses.find(
      (container) => container.name === "payment-api",
    ).imageID,
  };
}
