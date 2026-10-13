import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { root, environment, run } from './cloud.mjs';
import { createRuntimeClient, items, completedReply, toolData } from './runtime.mjs';
import { reviewedReportApproval } from './approval.mjs';
import { restoreSchedule, withPausedSchedule } from './schedule-safety.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { reportCalls } from './report-contract.mjs';

const action = process.argv[2];
if (!['report-create', 'report-approve', 'report-status', 'report-verify', 'schedule-status', 'schedule-run'].includes(action)) throw new Error('Usage: node scripts/features.mjs report-create|report-approve|report-status|report-verify|schedule-status|schedule-run');
const env = environment();
const token = run('az', ['account', 'get-access-token', '--scope', '59f0a04a-b322-4310-adc9-39ac41e9631e/.default', '--query', 'accessToken', '-o', 'tsv'], { stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const api = createRuntimeClient(env.SRE_AGENT_ENDPOINT, token);
const base = `/api/v1/agents/${encodeURIComponent(env.SRE_AGENT_NAME)}/reports`;
await mkdir(path.join(root, 'artifacts'), { recursive: true });
const scheduleMarker = path.join(root, 'artifacts', `schedule-restoration-${env.SRE_AGENT_NAME}.json`);
await restoreSchedule(api, scheduleMarker, env.SRE_AGENT_RESOURCE_ID);
const unwrap = value => value?.isSuccessful === false ? (() => { throw new Error(value.error || 'Native feature operation failed'); })() : value?.content ?? value;
if (action === 'report-create') {
  const created = process.argv[3] ? { authoringThreadId: process.argv[3] } : unwrap(await api(`${base}/authoring-thread`, 'POST'));
  if (!created.authoringThreadId) throw new Error('Native report authoring returned no thread ID');
  await writeFile(path.join(root, 'artifacts/native-report-authoring.json'), JSON.stringify({ ...created, nativeApi: base, createdUtc: new Date().toISOString(), savedReportVerified: false }, null, 2));
  const prompts = JSON.parse(await readFile(path.join(root, 'agent/prompts.json'), 'utf8'));
  await api(`/api/v1/threads/${created.authoringThreadId}/messages`, 'POST', { text: `${prompts['live-report']} 대상: ${env.AZURE_RESOURCE_GROUP}, ${env.AZURE_AKS_CLUSTER_NAME}. 네이티브 Live Reports 저장소에 저장하고 보고서 ID와 근거 쿼리를 알려 주세요.`, userId: process.env.USER || 'demo-operator', displayName: 'Demo Operator' });
  console.log(JSON.stringify({ threadId: created.authoringThreadId, nativeAuthoringStarted: true, savedReportVerified: false }));
} else if (action === 'report-approve') {
  const authoring = JSON.parse(await readFile(path.join(root, 'artifacts/native-report-authoring.json'), 'utf8'));
  const messages = items(await api(`/api/v1/threads/${authoring.authoringThreadId}/messages`));
  const reviewedId = process.argv[3] === '--reviewed' ? process.argv[4] : undefined;
  const approval = reviewedReportApproval(messages, authoring.authoringThreadId, reviewedId);
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const body = { Status: 'Approved', User: claims.puid || claims.oid, ApproveScope: 'none', ...(approval.oboTokenScope ? { Scope: approval.oboTokenScope } : {}) };
  const url = new URL(`/api/v1/approvals/${authoring.authoringThreadId}/${approval.id}/decision`, env.SRE_AGENT_ENDPOINT);
  const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(approval.oboTokenScope ? { 'x-sreagent-obo-scope': approval.oboTokenScope } : {}) }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Native report decision returned HTTP ${response.status}`);
  console.log(JSON.stringify({ reportSaveApproval: approval.id, threadId: authoring.authoringThreadId, scope: 'none' }));
} else if (action === 'schedule-status' || action === 'schedule-run') {
  const task = items(await api('/api/v1/scheduledtasks')).find(item => item.name === 'payment-daily-health');
  if (!task) throw new Error('Prepared scheduled task not found');
  if (action === 'schedule-run') {
    if (task.status !== 'Paused') throw new Error('Prepared task must be paused before bounded manual execution');
    if (task.nextExecutionTime && Date.parse(task.nextExecutionTime) < Date.now() + 600000) throw new Error('A cron execution is too close for bounded activation; use the native portal after reviewing the schedule');
    await withPausedSchedule(api, task, scheduleMarker, env.SRE_AGENT_RESOURCE_ID, async signal => {
      await api(`/api/v1/scheduledtasks/${task.id}/execute`, 'POST', undefined, { signal });
      const history = items(await api(`/api/v1/scheduledtasks/${task.id}/executions`, 'GET', undefined, { signal }));
      const execution = history[0];
      if (!execution?.threadId) throw new Error('Manual execution created no thread');
      const deadline = Date.now() + 600000;
      let finished = false;
      do {
        signal.throwIfAborted();
        const thread = await api(`/api/v1/threads/${execution.threadId}`, 'GET', undefined, { signal });
        if (completedReply(thread)) {
          const messages = items(await api(`/api/v1/threads/${execution.threadId}/messages`, 'GET', undefined, { signal }));
          await writeFile(path.join(root, `artifacts/thread-${execution.threadId}.json`), JSON.stringify({ thread, messages }, null, 2), { mode: 0o600 });
          finished = true;
          break;
        }
        const updated = items(await api(`/api/v1/scheduledtasks/${task.id}/executions`, 'GET', undefined, { signal })).find(item => item.threadId === execution.threadId);
        if (updated?.completed && !updated.success) throw new Error(`Manual task failed: ${updated.errorMessage}`);
        await delay(5000, undefined, { signal });
      } while (Date.now() < deadline);
      if (!finished) throw new Error('Manual execution produced no verified result within ten minutes');
    });
  }
  const saved = await api(`/api/v1/scheduledtasks/${task.id}`);
  const executions = await api(`/api/v1/scheduledtasks/${task.id}/executions`);
  await writeFile(path.join(root, 'artifacts/scheduled-task-status.json'), JSON.stringify(saved, null, 2));
  await writeFile(path.join(root, 'artifacts/scheduled-task-executions.json'), JSON.stringify(executions, null, 2));
  console.log(JSON.stringify({ id: saved.id, name: saved.name, status: saved.status, executions }, null, 2));
} else {
  const reports = items(unwrap(await api(base)));
  if (action === 'report-status') {
    console.log(JSON.stringify({ reports: reports.map(item => ({ id: item.id, name: item.name, version: item.currentVersionNumber })) }, null, 2));
  } else {
    const report = reports.find(item => /Payments.*Service.*Live.*Report/i.test(item.name));
    if (!report) throw new Error('Native Payments report is not saved in the gallery yet');
    const saved = unwrap(await api(`${base}/${encodeURIComponent(report.id)}`));
    const versions = unwrap(await api(`${base}/${encodeURIComponent(report.id)}/versions`));
    if (!saved.currentHtml || !items(versions).length) throw new Error('Native report has no saved HTML/version');
    const calls = reportCalls(saved.currentHtml, env);
    const refreshes = [];
    for (const call of calls) {
      const refreshed = unwrap(await api(`${base}/${encodeURIComponent(report.id)}/invoke-tool`, 'POST', { ...call, forceRefresh: true }));
      const data = toolData(refreshed);
      if (!Array.isArray(data.results)) throw new Error('Actual saved report query returned no result dataset');
      refreshes.push({ ...call, data });
    }
    const binding = { subscription: env.AZURE_SUBSCRIPTION_ID, agentId: env.SRE_AGENT_RESOURCE_ID, workspaceId: env.WORKSPACE_RESOURCE_ID, utc: new Date().toISOString() };
    await writeFile(path.join(root, 'artifacts/native-report-refresh.json'), JSON.stringify({ ...binding, version: saved.report.currentVersionNumber, refreshes }, null, 2));
    await writeFile(path.join(root, 'artifacts/native-report.json'), JSON.stringify({ ...binding, report: saved.report, versions, htmlBytes: Buffer.byteLength(saved.currentHtml), nativeGalleryVerified: true, actualReportQueriesVerified: true, verifiedCalls: calls }, null, 2));
    console.log(JSON.stringify({ reportId: report.id, name: report.name, versions: items(versions).length, nativeGalleryVerified: true, actualReportQueriesVerified: true, queries: calls.length, htmlBytes: Buffer.byteLength(saved.currentHtml) }));
  }
}