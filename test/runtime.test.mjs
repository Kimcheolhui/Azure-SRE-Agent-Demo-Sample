import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntimeClient, items, completedReply, toolData } from '../scripts/runtime.mjs';

test('runtime rejects insecure or untrusted endpoints and redirect routes', async () => {
  for (const endpoint of ['http://demo.azuresre.ai', 'https://example.com', 'https://name:pass@demo.azuresre.ai']) assert.throws(() => createRuntimeClient(endpoint, 'test-credential'));
  const api = createRuntimeClient('https://demo.azuresre.ai', 'test-credential');
  await assert.rejects(api('//example.com'), /relative/);
});
test('runtime sends exact JSON contracts without exposing error bodies', async () => {
  const calls = [];
  const api = createRuntimeClient('https://demo.azuresre.ai', 'test-credential', async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ name: 'specialist' }), { status: 200 });
  });
  assert.equal((await api('/api/v2/extendedAgent/agents/specialist', 'PUT', { name: 'specialist' })).name, 'specialist');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(JSON.parse(calls[0].options.body).name, 'specialist');
  const failing = createRuntimeClient('https://demo.azuresre.ai', 'test-credential', async () => new Response('secret-value', { status: 403 }));
  await assert.rejects(failing('/api/v1/threads'), error => !error.message.includes('secret-value') && error.message.includes('403'));
});
test('knowledge results support the service JSON-string envelope', () => {
  assert.deepEqual(items({ results: ['{"filename":"runbook.md"}'] }), [{ filename: 'runbook.md' }]);
  assert.deepEqual(items({ files: [{ name: 'runbook.md', isIndexed: false }] }), [{ name: 'runbook.md', isIndexed: false }]);
});

test('whole investigation is not completed by reasoning or a running tool', () => {
  const final = { author: { role: 'SREAgent' }, text: 'Investigation findings', isComplete: true, messageType: null };
  assert.equal(completedReply({ lastMessage: { ...final, messageType: 'Reasoning' } }), false);
  assert.equal(completedReply({ lastMessage: { ...final, kubectlExecution: { status: 'Running' } } }), false);
  assert.equal(completedReply({ lastMessage: { ...final, approval: { status: 'Pending' } } }), false);
  assert.equal(completedReply({ lastMessage: { ...final, text: '' } }), false);
  assert.equal(completedReply({ lastMessage: { ...final, text: '[SCHEDULED_TASK_EXECUTION]{"taskId":"task"}[/SCHEDULED_TASK_EXECUTION]' } }), false);
  assert.equal(completedReply({ waitReason: 'approval', lastMessage: final }), false);
  assert.equal(completedReply({ lastMessage: final }), true);
});

test('native MCP tool JSON envelopes are decoded and nested errors rejected', () => {
  const result = { status: 200, results: [{ Requests: '10' }] };
  assert.deepEqual(toolData({ content: [{ type: 'text', text: JSON.stringify(JSON.stringify(result)) }] }), result);
  assert.throws(() => toolData({ isError: true, content: [] }), /unsuccessful/);
  assert.throws(() => toolData({ content: [{ type: 'text', text: JSON.stringify({ status: 400 }) }] }), /unsuccessful/);
});