import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForAlertState } from '../scripts/alerts.mjs';

test('reset waits for existing Fired alerts to clear before a repeat run', async () => {
  let reads = 0;
  const result = await waitForAlertState({}, 'Resolved', { read: () => ++reads === 1 ? [{ id: 'old-alert' }] : [], wait: async () => {} });
  assert.equal(reads, 2);
  assert.equal(result.state, 'Resolved');
});
test('only a newly fired alert can bind the next automatic run', async () => {
  const after = '2026-01-02T00:00:00Z';
  let reads = 0;
  const result = await waitForAlertState({}, 'Fired', { after, read: () => [{ id: '/alerts/id', properties: { essentials: { startDateTime: ++reads === 1 ? '2026-01-01T00:00:00Z' : '2026-01-03T00:00:00Z' } } }], wait: async () => {} });
  assert.equal(reads, 2);
  assert.equal(result.id, 'id');
});
test('unresolved existing alert fails rather than claiming repeat readiness', async () => {
  await assert.rejects(waitForAlertState({}, 'Resolved', { timeoutMs: 0, read: () => [{ id: 'active' }] }), /Recover first/);
});