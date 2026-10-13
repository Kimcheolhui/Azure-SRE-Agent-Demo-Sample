import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewedReportApproval } from '../scripts/approval.mjs';

const approval = { id: 'reviewed-id', threadId: 'thread', status: 'Pending', title: 'thread-SaveReport', command: null, description: 'system-mcp-monitor query; another connector deletes data' };
test('a description mentioning a read-only namespace does not authorize a report', () => {
  assert.throws(() => reviewedReportApproval([{ approval }], 'thread'), /Description text alone/);
});
test('only the exact explicitly reviewed pending report approval can be decided', () => {
  assert.equal(reviewedReportApproval([{ approval }], 'thread', 'reviewed-id'), approval);
  assert.throws(() => reviewedReportApproval([{ approval }], 'thread', 'another-id'), /does not match/);
  assert.throws(() => reviewedReportApproval([{ approval }], 'another-thread', 'reviewed-id'), /does not match/);
  assert.throws(() => reviewedReportApproval([{ approval: { ...approval, status: 'Approved' } }], 'thread', 'reviewed-id'), /does not match/);
  assert.throws(() => reviewedReportApproval([{ approval: { ...approval, command: 'change workload' } }], 'thread', 'reviewed-id'), /does not match/);
});