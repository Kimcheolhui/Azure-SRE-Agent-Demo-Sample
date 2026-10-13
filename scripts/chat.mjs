import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { root, settings, run } from './cloud.mjs';
import { createRuntimeClient, items, completedReply } from './runtime.mjs';

const [action, target, key] = process.argv.slice(2);
if (!['start', 'follow', 'read', 'await'].includes(action)) throw new Error('Usage: node scripts/chat.mjs start PROMPT | follow THREAD PROMPT | read THREAD | await THREAD');
const env = settings();
const token = run('az', ['account', 'get-access-token', '--scope', '59f0a04a-b322-4310-adc9-39ac41e9631e/.default', '--query', 'accessToken', '-o', 'tsv'], { stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const api = createRuntimeClient(env.SRE_AGENT_ENDPOINT, token);
const prompts = JSON.parse(await readFile(path.join(root, 'agent/prompts.json'), 'utf8'));
const promptKey = action === 'start' ? target : key;
let threadId = target;
function message(name) {
  if (!prompts[name]) throw new Error(`Unknown prompt: ${name}`);
  return { text: prompts[name].replaceAll('rg-sredemokch14-workload', env.AZURE_RESOURCE_GROUP).replaceAll('aks-sredemokch14', env.AZURE_AKS_CLUSTER_NAME), userId: process.env.USER || 'demo-operator', displayName: 'Demo Operator', agent: name === 'investigation' ? 'payment-specialist' : env.SRE_AGENT_NAME };
}
if (action === 'start') {
  const thread = await api('/api/v1/threads', 'POST', { startMessage: message(promptKey) });
  if (!thread.id) throw new Error('Thread creation returned no ID');
  threadId = thread.id;
  console.log(JSON.stringify({ threadId, prompt: promptKey, state: 'started' }));
} else if (action === 'follow') {
  await api(`/api/v1/threads/${encodeURIComponent(threadId)}/messages`, 'POST', message(promptKey));
  console.log(JSON.stringify({ threadId, prompt: promptKey, state: 'sent' }));
}
await mkdir(path.join(root, 'artifacts'), { recursive: true });
if (action === 'start' || action === 'follow') process.exit(0);
const deadline = Date.now() + 600000;
do {
  const thread = await api(`/api/v1/threads/${encodeURIComponent(threadId)}`);
  const messages = items(await api(`/api/v1/threads/${encodeURIComponent(threadId)}/messages`));
  await writeFile(path.join(root, `artifacts/thread-${threadId}.json`), JSON.stringify({ thread, messages }, null, 2), { mode: 0o600 });
  const pending = messages.some(item => /pending/i.test(item.approval?.status || '') || item.userQuestion?.status === 'Pending');
  const complete = completedReply(thread);
  if (action === 'read' || pending || complete) {
    const final = messages.filter(item => item.author?.role !== 'user').at(-1);
    const text = (final?.text || thread.lastMessage?.text || '').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted-token]');
    console.log(JSON.stringify({ threadId, complete, pending, messages: messages.length, result: text.slice(0,5000) }, null, 2));
    process.exit(complete || action === 'read' ? 0 : 2);
  }
  await new Promise(resolve => setTimeout(resolve, 5000));
} while (Date.now() < deadline);
throw new Error('Thread did not complete within ten minutes; inspect the saved thread and do not claim investigation completion');