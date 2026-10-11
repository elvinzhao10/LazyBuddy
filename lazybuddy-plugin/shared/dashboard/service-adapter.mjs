import { executeCommand, readInput } from './commands.mjs';
import { safeRead, protectedServiceArtifact, ServiceError } from './service-files.mjs';
import { projectSnapshot } from './trusted-projection.mjs';
import { readBuddyCompletion } from './adapters/completion.mjs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { executeProjectCommand, readProject, readProjectSource } from '../project/cli.mjs';
import { assessPlanTransition } from '../project/plans/lifecycle.mjs';
import { collectLocalGitFacts } from '../project/git-observation/local.mjs';
import { buildArtifactIndex } from '../project/artifacts/index.mjs';
import { renderArtifactPreview } from '../project/artifacts/preview.mjs';
import { architectureFixture } from './ui/architecture-model.mjs';
import { evidenceFixture } from './ui/evidence-model.mjs';
import { gitDetailModel, metricsDetailModel } from './ui/git-metrics-model.mjs';
const packageMetadata = createRequire(import.meta.url)('../../tooling/package.json');

export const buddyAuthority = Object.freeze({
  read: readInput,
  execute: executeCommand,
  project: input => projectSnapshot(input, readBuddyCompletion(input, { packageVersion: packageMetadata.version })),
  readProject: (options, actor) => readProject({ projectRoot: options.projectRoot, projectId: options.projectId, actor }),
  readProjectSource: (options, actor, sourceId) => readProjectSource(
    { projectRoot: options.projectRoot, projectId: options.projectId, actor }, sourceId),
  commandProject: (options, actor, command) => executeProjectCommand(
    { projectRoot: options.projectRoot, projectId: options.projectId, actor }, command),
  assessProjectTransition: async (options, actor, request) => assessPlanTransition(
    await readProject({ projectRoot: options.projectRoot, projectId: options.projectId, actor }),
    request.plan_id, request.to_lifecycle, request.payload ?? {}),
  readProjectArchitecture: async (options, actor) => architectureFixture({
    snapshot: await readProject({ projectRoot: options.projectRoot, projectId: options.projectId, actor }),
  }),
  readProjectGit: async (options, actor) => {
    const project = await readProject({ projectRoot: options.projectRoot, projectId: options.projectId, actor });
    const local = await collectLocalGitFacts({ repositoryRoot: options.projectRoot,
      sourceScope: project.sources.map(source => source.path) });
    const git = gitDetailModel({ local });
    return { git, metrics: metricsDetailModel({ scope: 'project', asOf: local.observed_at,
      projectionRevision: project.revision, git }) };
  },
  readProjectEvidence: async (options, actor) => {
    const project = await readProject({ projectRoot: options.projectRoot, projectId: options.projectId, actor });
    return evidenceFixture({ index: await buildArtifactIndex(options.projectRoot, { snapshot: project }), snapshot: project });
  },
  readProjectEvidencePreview: async (options, actor, artifactId) => {
    const project = await readProject({ projectRoot: options.projectRoot, projectId: options.projectId, actor });
    const index = await buildArtifactIndex(options.projectRoot, { snapshot: project });
    const entry = index.entries.find(candidate => candidate.id === artifactId);
    if (!entry) throw new ServiceError('UNKNOWN_ARTIFACT', 404);
    return renderArtifactPreview(options.projectRoot, entry, { readFile: async (_root, relative, limit) => {
      const bytes = await safeRead(options.projectRoot, relative, limit);
      if (entry.sha256 && createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
        throw new ServiceError('ARTIFACT_CHANGED', 409);
      }
      return { bytes };
    } });
  },
  readReference: (options, reference) => {
    if (protectedServiceArtifact(reference)) throw new ServiceError('PROTECTED_SERVICE_ARTIFACT', 403);
    return safeRead(options.projectRoot, reference);
  },
});
export const authorityFor = options => options.authority ?? buddyAuthority;
