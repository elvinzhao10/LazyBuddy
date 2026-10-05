import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { serviceFixture } from '../test/service-fixture.mjs';

const destination = process.argv[2];
if (!destination) throw new Error('evidence directory required');
await mkdir(destination, { recursive: true });
const fixture = await serviceFixture();
try {
  const first = { url: fixture.live.url, port: fixture.live.identity.port };
  assert.equal((await fixture.cli('stop')).code, 0);
  await fixture.start();
  const second = { url: fixture.live.url, port: fixture.live.identity.port };
  const record = { source_head: 'a8b18f5db207aec9be65f2e6b77542a16f0a91fb + uncommitted UI/static edits before port repair', first, second,
    same_origin: first.url === second.url, observable: first.url === second.url ? 'unexpected same origin' : 'ephemeral restart changed browser origin' };
  await writeFile(`${destination}/port-restart-baseline.json`, `${JSON.stringify(record, null, 2)}\n`);
  assert.equal(record.same_origin, false);
} finally { await fixture.cleanup(); }
