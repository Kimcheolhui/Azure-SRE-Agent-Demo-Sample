import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportCalls } from '../scripts/report-contract.mjs';

const env = { APPINSIGHTS_RESOURCE_ID: '/subscriptions/sub/resourceGroups/demo/providers/Microsoft.Insights/components/app', AZURE_SUBSCRIPTION_ID: 'sub' };
function report(query = 'requests | where timestamp > ago(30m) | summarize total=count() by method', tool = 'system-mcp-monitor_monitor_resource_log_query', resource = env.APPINSIGHTS_RESOURCE_ID) {
  return `<html><script>const TOOL=${JSON.stringify(tool)};const SUB='sub';const RES_ID=${JSON.stringify(resource)};async function query(kql){return window.sreagent.callTool(TOOL,{'resource-id':RES_ID,table:'requests',query:kql,hours:1,limit:500,subscription:SUB})}async function refresh(){const q1=${JSON.stringify(query)};await query(q1)}</script></html>`;
}
test('saved report queries are extracted without evaluating generated JavaScript', () => {
  const calls = reportCalls(report(), env);
  assert.equal(calls.length, 1);
  assert(calls[0].args.query.includes('by method'));
  assert.equal(calls[0].args['resource-id'], env.APPINSIGHTS_RESOURCE_ID);
});
test('actual report time, tool and target mismatches fail rather than use a substitute query', () => {
  assert.throws(() => reportCalls(report('requests | where timestamp > ago(1h)'), env), /thirty-minute/);
  assert.throws(() => reportCalls(report(undefined, 'dangerous-delete-tool'), env), /unapproved tool/);
  assert.throws(() => reportCalls(report(undefined, undefined, '/foreign/workspace'), env), /different environment/);
  assert.throws(() => reportCalls('<html>static snapshot only</html>', env), /No statically verified/);
});