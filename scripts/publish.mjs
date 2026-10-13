import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root, run } from './cloud.mjs';

const mode = process.argv[2];
if (!['--prepare', '--push'].includes(mode)) throw new Error('Usage: node scripts/publish.mjs --prepare|--push');
const remote = 'https://github.com/Kimcheolhui/Azure-SRE-Agent-Demo-Sample.git';
const quiet = { stdio: ['ignore', 'pipe', 'pipe'] };
let top;
try { top = run('git', ['rev-parse', '--show-toplevel'], quiet).trim(); } catch {}
if (top && path.resolve(top) !== root) throw new Error('Refusing to publish a parent or unrelated Git repository');
if (!top) run('git', ['init', '-b', 'main'], quiet);
let existing;
try { existing = run('git', ['remote', 'get-url', 'origin'], quiet).trim(); } catch {}
if (existing && existing !== remote) throw new Error('Origin does not match the requested repository');
if (!existing) run('git', ['remote', 'add', 'origin', remote], quiet);
const sources = ['.gitignore', '.dockerignore', 'README.md', 'azure.yaml', 'package.json', 'package-lock.json', 'app', 'agent', 'infra', 'k8s', 'queries', 'scripts', 'test', 'docs'];
run('git', ['add', '--', ...sources], quiet);
const changed = run('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], quiet).split('\0').filter(Boolean);
for (const filename of changed) {
  if (/(^|\/)(?:\.azure|artifacts|node_modules|\.env(?:\..*)?)(\/|$)|\.(?:pem|key|pfx|p12|kubeconfig)$/i.test(filename)) throw new Error(`Refusing to commit a runtime or credential file: ${filename}`);
  const text = await readFile(path.join(root, filename), 'utf8');
  if (/gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text)) throw new Error(`Potential credential in staged source: ${filename}`);
}
if (changed.length) run('git', ['commit', '-m', 'Prepare Azure SRE Agent demo and harden customer rehearsal'], { stdio: 'inherit' });
const revision = run('git', ['rev-parse', 'HEAD'], quiet).trim();
if (mode === '--push') {
  run('gh', ['auth', 'status'], quiet);
  const account = run('gh', ['api', 'user', '--jq', '.login'], quiet).trim();
  if (account.toLowerCase() !== 'kimcheolhui') throw new Error('GitHub CLI is signed in as a different account');
  run('gh', ['auth', 'setup-git'], quiet);
  run('git', ['push', '--set-upstream', 'origin', 'main'], { stdio: 'inherit', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const published = run('git', ['ls-remote', 'origin', 'refs/heads/main'], quiet).split(/\s+/)[0];
  if (published !== revision) throw new Error('Remote main does not match the prepared commit');
}
console.log(JSON.stringify({ localCommit: revision, remote, published: mode === '--push', authenticationRequiredForPush: mode !== '--push' }));