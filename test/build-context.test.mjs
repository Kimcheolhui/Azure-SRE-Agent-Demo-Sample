import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import dockerignore from '@balena/dockerignore';

test('remote build includes only required inputs and excludes nested credentials', async () => {
  const filter = dockerignore().add(await readFile(new URL('../.dockerignore', import.meta.url), 'utf8'));
  for (const filename of ['package.json', 'package-lock.json', 'app/Dockerfile', 'app/src/app.mjs', 'app/releases/v1.9/provider-client.mjs']) assert.equal(filter.ignores(filename), false, filename);
  for (const filename of ['.env', '.env.production', 'app/src/.env.local', 'app/src/private.pem', 'artifacts/demo.kubeconfig', '.azure/config.json', 'docs/verification.html', 'unrelated.txt']) assert.equal(filter.ignores(filename), true, filename);
});