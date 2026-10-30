import { ContractError, parseContract, stableJSON } from './contracts/parse.mjs';
import { reviewIsCurrent } from './ui/verification-history.mjs';

export function reviewAdmission({ snapshot, request: raw, mode }) {
  const request = parseContract('review_admission_request', raw);
  if (!['inspect', 'admit', 'observe'].includes(mode)) throw new ContractError('INVALID_REVIEW_MODE');
  const reviews = (snapshot.state.reviews ?? []).map(review => parseContract('review', review));
  const review = reviews.filter(review => review.task_id === request.task_id && review.criterion_id === request.criterion_id).at(-1);
  if (!review) {
    if (request.review_id !== null) throw new ContractError('REVIEW_SCOPE_MISMATCH');
    return { changed: false, reviews, binding: null };
  }
  const task = snapshot.state.tasks.find(task => task.id === request.task_id);
  const criterion = task?.criteria?.find(criterion => criterion.id === request.criterion_id);
  if (!reviewIsCurrent(review, snapshot, criterion)) throw new ContractError('STALE_REVIEW_SUBJECT');
  if (request.review_id !== null && request.review_id !== review.id) throw new ContractError('REVIEW_SUPERSEDED');
  if (request.subject !== null && stableJSON(request.subject) !== stableJSON(review.subject)) throw new ContractError('STALE_REVIEW_SUBJECT');
  if (mode !== 'inspect' && (request.review_id === null || request.subject === null)) throw new ContractError('REVIEW_BINDING_REQUIRED');
  const owned = review.consumed_attempt_id === request.attempt_id && review.consumed_by === request.worker_id && review.consumed_role === request.role;
  const continuation = request.role === 'verifier' && review.consumed_role === 'worker'
    && request.executor_attempt_id === review.consumed_attempt_id && request.worker_id !== review.consumed_by;
  let changed = false;
  switch (review.state) {
    case 'pending': case 'rejected': throw new ContractError('REVIEW_NOT_APPROVED');
    case 'approved':
      if (mode === 'observe') throw new ContractError('REVIEW_ADMISSION_REQUIRED');
      if (mode === 'admit') {
        review.state = 'consumed'; review.consumed_by = request.worker_id;
        review.consumed_attempt_id = request.attempt_id; review.consumed_role = request.role; changed = true;
      }
      break;
    case 'consumed':
      if (owned && mode !== 'observe') throw new ContractError('REVIEW_ALREADY_CONSUMED');
      if (!owned && !continuation) throw new ContractError('REVIEW_ALREADY_CONSUMED');
      if (continuation) {
        const reserved = review.consumed_verifier_attempt_id === request.attempt_id && review.consumed_verifier_id === request.worker_id;
        if (review.consumed_verifier_attempt_id && !reserved) throw new ContractError('REVIEW_ALREADY_CONSUMED');
        if (reserved && mode !== 'observe') throw new ContractError('REVIEW_ALREADY_CONSUMED');
        if (mode === 'observe' && !reserved) throw new ContractError('REVIEW_ADMISSION_REQUIRED');
        if (mode === 'admit' && !reserved) {
          review.consumed_verifier_attempt_id = request.attempt_id; review.consumed_verifier_id = request.worker_id; changed = true;
        }
      }
      break;
    default: throw new ContractError('INVALID_REVIEW_STATE');
  }
  return { changed, reviews, binding: { review_id: review.id, subject: review.subject,
    role: request.role, executor_attempt_id: request.executor_attempt_id } };
}
