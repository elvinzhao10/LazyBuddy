import { createRequire } from 'node:module';
import { capturedCompletion } from '../commands.mjs';
import { authorityBinding } from '../revision-compatibility.mjs';
const require = createRequire(import.meta.url);
const assessments = new WeakMap();
export function readBuddyCompletion(input, options) {
  const { assessCapturedCompletion } = require('../../../scripts/completion-assessment.js');
  const bundle = capturedCompletion(input);
  const assessment = assessCapturedCompletion(bundle, { ...options, remediationCommand: 'show_run_status' });
  const matches = assessment.status !== 'ready' || (bundle.current.head === input.source_revision &&
    assessment.authority.plan.path === input.state.plan_reference && assessment.authority.plan.sha256 === input.plan_digest);
  const result = matches ? assessment : { status: 'blocked', reason_code: 'CAPTURE_BINDING_MISMATCH' };
  const proof = Object.freeze({ status: result.status, reason: result.reason_code });
  if (result.status === 'ready')
    assessments.set(proof, { authority: result.authority, input, state: input.state, binding: authorityBinding(input) });
  return proof;
}
export function completionApplies(proof, binding, criterion) {
  const captured = proof && assessments.get(proof);
  if (!captured || captured.input !== binding || captured.state !== binding.state || captured.binding !== authorityBinding(binding)) return false;
  const authority = captured.authority;
  return Boolean(authority && authority.run_id === binding.run_id &&
    authority.criteria.some(item => item.applicable && item.task_id === criterion.task_id && item.criterion_id === criterion.id) &&
    binding.source_revision === authority.repo_head && binding.plan_digest === authority.plan.sha256 &&
    criterion.version === (authority.criteria.find(item => item.criterion_id === criterion.id)?.criterion_version ?? 1));
}
