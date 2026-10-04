import { executeCommand, readInput } from './commands.mjs';
import { safeRead } from './service-files.mjs';
import { projectSnapshot } from './projection.mjs';

export const buddyAuthority = Object.freeze({
  read: readInput,
  execute: executeCommand,
  project: projectSnapshot,
  readReference: (options, reference) => safeRead(options.projectRoot, reference),
});
export const authorityFor = options => options.authority ?? buddyAuthority;
