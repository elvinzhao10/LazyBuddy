#!/usr/bin/env node
import { readFile, writeFile, access, watch } from 'node:fs/promises';
import { dirname, basename } from 'node:path';

const [action, artifact, expected] = process.argv.slice(2);
if (action === 'write') {
  await writeFile(artifact, `${expected}\n`);
  process.stdout.write(`${JSON.stringify({ artifact, value: expected })}\n`);
} else if (action === 'fail') {
  await writeFile(artifact, `${expected}\n`);
  process.stderr.write(`${JSON.stringify({ artifact, value: expected, forced_failure: true })}\n`);
  process.exitCode = 9;
} else if (action === 'wait-write') {
  const [started, release] = process.argv.slice(5);
  await writeFile(started, `${process.pid}\n`);
  try { await access(release); }
  catch {
    const events = watch(dirname(release));
    for await (const event of events) if (event.filename === basename(release)) break;
  }
  await writeFile(artifact, `${expected}\n`);
  process.stdout.write(`${JSON.stringify({ artifact, value: expected })}\n`);
} else if (action === 'verify') {
  const actual = await readFile(artifact, 'utf8');
  if (actual !== `${expected}\n`) process.exitCode = 9;
  else process.stdout.write('{"verdict":"approved"}\n');
} else process.exitCode = 64;
