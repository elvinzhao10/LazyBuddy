const same = (left, right) => left.criterion_version === right.criterion_version
  && left.plan_revision === right.plan_revision && left.source_revision === right.source_revision
  && left.plan_sha256 === right.plan_sha256 && left.content_sha256 === right.content_sha256;

export function reviewSubject(input, criterion) {
  return { criterion_version: criterion.version, plan_revision: input.plan_revision,
    source_revision: input.source_revision ?? input.review_context?.source_revision ?? null,
    plan_sha256: input.review_plan_current === false ? null : input.plan_digest ?? input.review_context?.plan_sha256 ?? null,
    content_sha256: input.review_content_sha256 ?? input.review_context?.content_sha256 ?? null };
}

export function reviewIsCurrent(review, input, criterion) {
  return Boolean(criterion && review.subject.plan_sha256 && review.subject.content_sha256 && same(review.subject, reviewSubject(input, criterion)));
}

export function compareAttempts(left, right) {
  if (!left || !right) return { comparable: false, reasons: ['Select two attempts'], changes: [] };
  const reasons = [];
  for (const field of ['task_id', 'criterion_id', 'criterion_version', 'plan_revision', 'source_revision']) {
    if (left[field] !== right[field]) reasons.push(`Different ${field.replaceAll('_', ' ')}`);
  }
  if (!left.criterion_id || left.criterion_version === null) reasons.push('Criterion subject is unreported');
  if (!left.source_revision || !right.source_revision) reasons.push('Source revision is unreported');
  if (left.consumed_plan_revision !== left.plan_revision || right.consumed_plan_revision !== right.plan_revision) reasons.push('Plan consumption is unobserved');
  const changes = ['execution', 'verification', 'worker_id'].filter(field => left[field] !== right[field])
    .map(field => ({ field, before: left[field], after: right[field] }));
  return { comparable: reasons.length === 0, reasons, changes,
    evidence: { before: left.evidence.length, after: right.evidence.length } };
}

export function criterionVersions(criterion) {
  return [...criterion.history.map(version => ({ ...version, scenarios: version.scenarios ?? null })),
    { version: criterion.version, requirement: criterion.requirement, scenarios: criterion.scenarios, result_ids: criterion.result_ids }];
}

export function compareCriterionVersions(criterion, beforeVersion, afterVersion) {
  const versions = criterionVersions(criterion);
  const before = versions.find(item => item.version === beforeVersion);
  const after = versions.find(item => item.version === afterVersion);
  if (!before || !after) return null;
  const oldScenarios = new Map((before.scenarios ?? []).map(item => [item.id, item]));
  const newScenarios = new Map((after.scenarios ?? []).map(item => [item.id, item]));
  return { before, after, requirement_changed: before.requirement !== after.requirement,
    scenarios_observed: before.scenarios !== null && after.scenarios !== null,
    added: [...newScenarios.keys()].filter(id => !oldScenarios.has(id)),
    removed: [...oldScenarios.keys()].filter(id => !newScenarios.has(id)),
    changed: [...newScenarios].filter(([id, item]) => oldScenarios.has(id)
      && (item.requirement !== oldScenarios.get(id).requirement || item.verifier_ref !== oldScenarios.get(id).verifier_ref)).map(([id]) => id) };
}

export function verificationRows(snapshot, { query = '', status = 'all', offset = 0, limit = 25 } = {}) {
  const search = query.trim().toLocaleLowerCase();
  const matches = [];
  for (const task of snapshot.tasks) for (const criterion of task.criteria) {
    if (status !== 'all' && criterion.verification !== status) continue;
    if (search && !`${task.id} ${task.title} ${criterion.id} ${criterion.requirement}`.toLocaleLowerCase().includes(search)) continue;
    matches.push({ task, criterion });
  }
  const pageSize = Math.max(1, Math.min(100, Number.isSafeInteger(limit) ? limit : 25));
  const start = Math.max(0, Math.min(Number.isSafeInteger(offset) ? offset : 0, Math.max(0, Math.ceil(matches.length / pageSize) - 1) * pageSize));
  return { rows: matches.slice(start, start + pageSize), total: matches.length, offset: start, limit: pageSize };
}
