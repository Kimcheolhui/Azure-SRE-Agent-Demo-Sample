import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { root, run } from './cloud.mjs';

export function fingerprintEntries(entries) {
  const hash = createHash('sha256');
  for (const [name, content] of [...entries].sort(([left], [right]) => left.localeCompare(right))) hash.update(name).update('\0').update(content).update('\0');
  return hash.digest('hex').slice(0,16);
}
export async function buildFingerprint() {
  const sourceFiles = (await readdir(path.join(root, 'app/src'))).map(name => `app/src/${name}`);
  const filenames = [...sourceFiles, 'app/releases/v1.9/provider-client.mjs', 'app/Dockerfile', 'package.json', 'package-lock.json'];
  const entries = await Promise.all(filenames.map(async filename => [filename, await readFile(path.join(root, filename))]));
  return fingerprintEntries(entries);
}
export async function publishedRevision() {
  try {
    const options = { stdio: ['ignore', 'pipe', 'pipe'] };
    const dirty = run('git', ['status', '--porcelain', '--', 'app', 'package.json', 'package-lock.json'], options).trim();
    if (dirty) return 'unpublished';
    const revision = run('git', ['rev-parse', 'HEAD'], options).trim();
    if (!/^[a-f0-9]{40}$/.test(revision)) return 'unpublished';
    const response = await fetch(`https://api.github.com/repos/Kimcheolhui/Azure-SRE-Agent-Demo-Sample/commits/${revision}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return 'unpublished';
    const commit = await response.json();
    return commit.sha === revision ? revision : 'unpublished';
  } catch {
    return 'unpublished';
  }
}