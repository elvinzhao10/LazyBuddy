#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lifecycle } from './service-lifecycle.mjs';
import { executableIdentity, started, removeReceipt } from './service-identity.mjs';
import { secret } from './service-auth.mjs';
import { listen } from './service-http.mjs';
import { ServiceError } from './service-files.mjs';

async function serve() {
  if (!process.send) throw new ServiceError('OWNED_LAUNCH_REQUIRED');
  let server; let promoted = false; let options; let identity; let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    if (!promoted && options && identity) await removeReceipt(options, identity.instance);
    if (server) await server.close();
    process.exit(0);
  };
  const watchdog = setTimeout(() => stop(), 12000);
  process.on('disconnect', () => { if (!promoted) stop(); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.on('message', async message => {
    try {
      switch (message.action) {
        case 'initialize': {
          if (options) throw new ServiceError('ALREADY_INITIALIZED'); options = message.options;
          identity = { projectRoot: options.projectRoot, projectId: options.projectId, runId: options.runId,
            pid: process.pid, started: await started(process.pid), instance: secret(), ...await executableIdentity() };
          server = await listen(options, { identity, credential: message.credential, closed: () => process.exit(0) });
          process.send({ ready: true, identity }); break;
        }
        case 'promote': promoted = true; clearTimeout(watchdog); process.send({ promoted: true }); break;
        case 'abort': await stop(); break;
        default: throw new ServiceError('UNKNOWN_CONTROL');
      }
    } catch { await stop(); }
  });
}
export async function main(argv) {
  if (argv.length === 1 && argv[0] === 'serve') return serve();
  const [action, ...args] = argv;
  if (!['start', 'status', 'stop'].includes(action) || args.length % 2) throw new ServiceError('INVALID_ARGV');
  const names = { '--project-root': 'projectRoot', '--project-id': 'projectId', '--run-id': 'runId', '--python': 'python', '--asset-root': 'assetRoot', '--port': 'port' }; const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = names[args[index]];
    if (!name || options[name] || !args[index + 1]) throw new ServiceError('INVALID_ARGV'); options[name] = args[index + 1];
  }
  if (options.port !== undefined) options.port = Number(options.port);
  options.assetRoot ??= fileURLToPath(new URL('./ui', import.meta.url));
  return lifecycle(action, options);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then(value => { if (value) process.stdout.write(`${JSON.stringify(value)}\n`); })
    .catch(error => { process.stderr.write(`${JSON.stringify({ status: 'rejected', code: error instanceof ServiceError ? error.code : 'SERVICE_FAILURE' })}\n`); process.exitCode = 65; });
}
