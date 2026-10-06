import { createHash } from 'node:crypto';
import { ARTIFACT_ID_PATTERN, artifactFail, assertRegistrableArtifactPath, readArtifactFile } from './paths.mjs';
import { classifyArtifact } from './index.mjs';

// Composes T02 `artifact.register` commands with local, typed prechecks: the path is
// registrable (relative, no traversal, no protected namespaces), the file is real,
// bounded and not a symlink, and the recorded digest is computed from actual bytes.
// The command itself is only ever accepted through the model/CLI command route.

export async function prepareArtifactRegistration(root, request) {
  const { project_id, expected_revision, command_id, producer, path, id, type, expected_sha256 } = request ?? {};
  if (typeof project_id !== 'string' || !project_id.length ||
      typeof command_id !== 'string' || !command_id.length ||
      typeof producer !== 'string' || !producer.length || producer.length > 8192 ||
      !Number.isSafeInteger(expected_revision) || expected_revision < 0) {
    artifactFail('INVALID_REGISTRATION_REQUEST', 'A registration needs a project, command identity, producer and revision');
  }
  assertRegistrableArtifactPath(path);
  const content = await readArtifactFile(root, path);
  const sha256 = createHash('sha256').update(content.bytes).digest('hex');
  if (expected_sha256 != null) {
    if (typeof expected_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected_sha256)) {
      artifactFail('INVALID_REGISTRATION_REQUEST', 'An expected digest must be a SHA-256 hex string');
    }
    if (expected_sha256 !== sha256) {
      artifactFail('ARTIFACT_DIGEST_MISMATCH', 'The artifact bytes do not match the requested digest');
    }
  }
  const artifactType = type ?? classifyArtifact(path);
  if (artifactType == null) {
    artifactFail('ARTIFACT_TYPE_REQUIRED', 'An unclassifiable artifact requires an explicit type');
  }
  const artifactId = id ?? `artifact:${path}`;
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
    artifactFail('INVALID_ARTIFACT_ID', 'The artifact identity is not representable');
  }
  return {
    command: {
      schema_version: 1, command_id, project_id, expected_revision,
      operation: 'artifact.register',
      payload: { id: artifactId, type: artifactType, producer, path, sha256 },
    },
    artifact: { id: artifactId, type: artifactType, producer, path, sha256,
      bytes: content.size, created_at: content.modified_at },
  };
}
