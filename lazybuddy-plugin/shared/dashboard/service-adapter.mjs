import { executeCommand, readInput } from './commands.mjs';
import { safeRead, protectedServiceArtifact, ServiceError } from './service-files.mjs';
import { projectSnapshot } from './trusted-projection.mjs';
import { readBuddyCompletion } from './adapters/completion.mjs';
import { createRequire } from 'node:module';
const packageMetadata = createRequire(import.meta.url)('../../tooling/package.json');

export const buddyAuthority = Object.freeze({
  read: readInput,
  execute: executeCommand,
  project: input => projectSnapshot(input, readBuddyCompletion(input, { packageVersion: packageMetadata.version })),
  readReference: (options, reference) => {
    if (protectedServiceArtifact(reference)) throw new ServiceError('PROTECTED_SERVICE_ARTIFACT', 403);
    return safeRead(options.projectRoot, reference);
  },
});
export const authorityFor = options => options.authority ?? buddyAuthority;
