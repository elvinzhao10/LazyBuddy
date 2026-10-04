import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assessments = new WeakMap();
export function readBuddyCompletion(projectRoot, options) {
  const { assessCompletion } = require('../../../scripts/completion-assessment.js');
  const result = assessCompletion(projectRoot, { ...options, remediationCommand: 'show_run_status' });
  const proof = Object.freeze({ status: result.status, reason: result.reason_code });
  let authority = null;
  if (result.status === 'ready') authority = JSON.parse(fs.readFileSync(path.resolve(projectRoot, options.authorityPath), 'utf8'));
  assessments.set(proof, authority);
  return proof;
}
export function completionApplies(proof, binding, criterion) {
  const authority = proof && assessments.get(proof);
  return Boolean(authority && authority.run_id === binding.run_id &&
    authority.criteria.some(item => item.applicable && item.task_id === criterion.task_id && item.criterion_id === criterion.id) &&
    binding.source_revision === authority.repo_head && binding.plan_digest === authority.plan.sha256 &&
    criterion.version === (authority.criteria.find(item => item.criterion_id === criterion.id)?.criterion_version ?? 1));
}
