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
import { readProjectObservations, recordProjectObservations } from './adapters/observations.mjs';
import { collectProjectHealth } from './adapters/health.mjs';
import { runtimeTelemetry, attachCostHistory } from './adapters/telemetry.mjs';
import { assertAdmissionForTransition, recheckProjectAdmission } from './adapters/admission.mjs';
import { queryCheckpointHistory } from './ui/checkpoint-history.mjs';
const packageMetadata = createRequire(import.meta.url)('../../tooling/package.json');

export const buddyAuthority = Object.freeze({
  read: readInput,
  execute: executeCommand,
  readHistory: async (options, request) => queryCheckpointHistory(await readInput(options), request,
    async revision => JSON.parse(await safeRead(options.projectRoot, `.lazybuddy/runs/${options.runId}/history/dashboard-${revision}/state.json`))),
  project: input => projectSnapshot(input, readBuddyCompletion(input, { packageVersion: packageMetadata.version })),
  readProject: (options, actor) => readProject({ projectRoot: options.projectRoot, projectId: options.projectId, actor }),
  readProjectSource: (options, actor, sourceId) => readProjectSource(
    { projectRoot: options.projectRoot, projectId: options.projectId, actor }, sourceId),
  commandProject: async (options, actor, command) => {
    // Served admission rechecking: a transition into `active` is the moment a
    // plan is admitted to execution, so any recorded admission evidence for
    // that plan is revalidated against the current accepted project first. A
    // stale or unsatisfied verifier gate refuses the command with the
    // documented blocked reason; plans without recorded evidence keep the
    // bridge's own transition rules.
    if (command?.operation === 'plan.transition' && command?.payload?.to_lifecycle === 'active') {
      await assertAdmissionForTransition(options, actor, command.payload.plan_id);
    }
    return executeProjectCommand(
      { projectRoot: options.projectRoot, projectId: options.projectId, actor }, command);
  },
  assessProjectTransition: async (options, actor, request) => assessPlanTransition(
    await readProject({ projectRoot: options.projectRoot, projectId: options.projectId, actor }),
    request.plan_id, request.to_lifecycle, request.payload ?? {}),
  recheckProjectAdmission: (options, actor, request) => recheckProjectAdmission(
    { projectRoot: options.projectRoot, projectId: options.projectId }, actor, request),
  readProjectObservations: options => readProjectObservations(options),
  readProjectHealth: (options, actor) => collectProjectHealth(options, actor),
  readProjectTelemetry: async (options, actor) => {
    const project = await readProject({ projectRoot: options.projectRoot, projectId: options.projectId, actor });
    let run = null; let error = null;
    try { if (options.runId) run = buddyAuthority.project(await readInput(options)); }
    catch (failure) { if (failure.code !== 'RUN_NOT_BOUND') error = failure.code ?? 'RUN_READ_FAILED'; }
    return attachCostHistory(runtimeTelemetry(project, run, error), { runtime: 'LazyBuddy',
      readFile: (reference, limit) => safeRead(options.projectRoot, reference, limit) });
  },
  recordProjectObservations: (options, actor, records) => recordProjectObservations(options, records),
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
