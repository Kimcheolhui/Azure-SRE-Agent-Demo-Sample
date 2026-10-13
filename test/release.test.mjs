import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprintEntries, buildFingerprint } from '../scripts/release.mjs';

test('release fingerprints include file names and contents with stable ordering', () => {
  const entries = [['app/app.mjs', 'source'], ['app/Dockerfile', 'node:22']];
  const original = fingerprintEntries(entries);
  assert.equal(original, fingerprintEntries([...entries].reverse()));
  assert.notEqual(original, fingerprintEntries([entries[0], ['app/Dockerfile', 'node:22-alpine']]));
  assert.notEqual(original, fingerprintEntries([['app/other.mjs', 'source'], entries[1]]));
});
test('actual build inputs produce a bounded immutable tag fingerprint', async () => {
  assert.match(await buildFingerprint(), /^[a-f0-9]{16}$/);
});