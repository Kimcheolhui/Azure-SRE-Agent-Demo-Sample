import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { restoreSchedule, withPausedSchedule } from '../scripts/schedule-safety.mjs';

async function fixture(context) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sre-schedule-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'pending.json');
}
test('schedule failure restores paused status and clears durable marker', async context => {
  const marker = await fixture(context);
  const calls = [];
  const api = async route => { calls.push(route); return { name: 'payment-daily-health', status: 'Paused' }; };
  await assert.rejects(withPausedSchedule(api, { id: 'task', name: 'payment-daily-health', status: 'Paused' }, marker, 'target', async () => { throw new Error('failed'); }), /failed/);
  assert(calls.some(route => route.endsWith('/pause')));
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});
test('crash restoration is bound to Agent and verifies paused status', async context => {
  const marker = await fixture(context);
  await writeFile(marker, JSON.stringify({ taskId: 'task', name: 'payment-daily-health', target: 'target' }));
  const calls = [];
  const api = async route => { calls.push(route); return { name: 'payment-daily-health', status: 'Paused' }; };
  await assert.rejects(restoreSchedule(api, marker, 'foreign'), /different Agent/);
  assert.equal(calls.length, 0);
  assert.equal(await restoreSchedule(api, marker, 'target'), true);
});
for (const signal of ['SIGINT', 'SIGTERM']) test(`${signal} waits for Pause before terminating`, async context => {
  const marker = await fixture(context);
  const moduleUrl = new URL('../scripts/schedule-safety.mjs', import.meta.url).href;
  const program = `import {withPausedSchedule} from ${JSON.stringify(moduleUrl)};import {setTimeout as delay} from 'node:timers/promises';const api=async route=>{if(route.endsWith('/resume'))console.log('RESUMED');if(route.endsWith('/pause'))console.log('PAUSED');return {name:'payment-daily-health',status:'Paused'}};try{await withPausedSchedule(api,{id:'task',name:'payment-daily-health',status:'Paused'},${JSON.stringify(marker)},'target',async signal=>{console.log('WAITING');await delay(60000,undefined,{signal})})}catch{console.log('INTERRUPTED')}`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe'] });
  context.after(() => child.kill('SIGKILL'));
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  while (!output.includes('WAITING')) await once(child.stdout, 'data');
  const exited = once(child, 'exit');
  child.kill(signal);
  const [code] = await exited;
  assert(output.includes('PAUSED'));
  assert.equal(code, signal === 'SIGINT' ? 130 : 143);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});