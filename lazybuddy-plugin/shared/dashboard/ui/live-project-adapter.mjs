export class LiveProjectError extends Error {
  constructor(code, status = 0) { super(code); this.name = 'LiveProjectError'; this.code = code; this.status = status; }
}

const currentWorktree = project => project.worktrees?.entries?.find(entry => entry.current) ?? null;

export function overviewBundle(project) {
  if (!project || typeof project !== 'object' || !Array.isArray(project.plans)) throw new LiveProjectError('INVALID_PROJECT');
  const worktree = currentWorktree(project);
  return {
    snapshot: project,
    project_name: project.project_id,
    readiness: {},
    planEdges: [],
    external_prerequisites: [],
    context: worktree ? { branch: worktree.branch ?? null, head: worktree.head ?? null } : null,
  };
}

export function createLiveProjectAdapter({ connection }) {
  if (!connection || typeof connection.project !== 'function' || typeof connection.projectSource !== 'function') {
    throw new TypeError('A dashboard connection with project reads is required');
  }
  let project = null;
  return {
    get current() { return project; },
    async read() {
      try { project = (await connection.project()).project; return project; }
      catch (error) {
        if (error?.body?.code === 'PROJECT_NOT_INITIALIZED') { project = null; return null; }
        throw new LiveProjectError(error?.body?.code ?? error?.message ?? 'PROJECT_READ_FAILED', error?.status ?? 0);
      }
    },
    source(sourceId) { return connection.projectSource(sourceId); },
    detail(kind) { return connection.projectDetail(kind); },
    async command(command) {
      try { return await connection.projectCommand(command); }
      catch (error) { throw new LiveProjectError(error?.body?.reason ?? error?.body?.code ?? error?.message ?? 'PROJECT_COMMAND_FAILED', error?.status ?? 0); }
    },
    assessTransition(_snapshot, planId, toLifecycle, payload = {}) {
      return connection.assessProjectTransition({ plan_id: planId, to_lifecycle: toLifecycle, payload });
    },
    previewArtifact(artifactId) { return connection.projectEvidencePreview(artifactId); },
    bundle() { return project ? overviewBundle(project) : null; },
  };
}
