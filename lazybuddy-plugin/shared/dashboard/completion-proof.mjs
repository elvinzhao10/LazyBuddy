import { authorityBinding } from './revision-compatibility.mjs';

const assessments = new WeakMap();

export function registerCompletionProof(proof, input, authority) {
  assessments.set(proof, { authority, input, state: input.state, binding: authorityBinding(input) });
}

export function completionApplies(proof, binding, criterion) {
  const captured = proof && assessments.get(proof);
  if (!captured || captured.input !== binding || captured.state !== binding.state
    || captured.binding !== authorityBinding(binding)) return false;
  const authority = captured.authority;
  return Boolean(authority && authority.run_id === binding.run_id
    && authority.criteria.some(item => item.applicable && item.task_id === criterion.task_id
      && item.criterion_id === criterion.id && criterion.version === (item.criterion_version ?? 1))
    && binding.source_revision === authority.repo_head && binding.plan_digest === authority.plan.sha256);
}
