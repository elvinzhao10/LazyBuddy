import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewAdmission } from '../review-admission.mjs';
const subject = { criterion_version: 1, plan_revision: 2, source_revision: 'head', plan_sha256: 'a'.repeat(64), content_sha256: 'b'.repeat(64) };
function fixture(state = 'approved') {
  const review = { id: 'review:one', task_id: 'T1', criterion_id: 'C1', action: 'rerun_criterion', subject,
    state, requested_by: 'requester', decided_by: state === 'pending' ? null : 'reviewer', rationale: null, consumed_by: null };
  return { snapshot: { plan_revision: 2, source_revision: 'head', plan_digest: subject.plan_sha256, review_content_sha256: subject.content_sha256,
    state: { tasks: [{ id: 'T1', criteria: [{ id: 'C1', version: 1 }] }], reviews: [review] } },
    request: { review_id: review.id, subject, task_id: 'T1', criterion_id: 'C1', attempt_id: 'attempt:one', worker_id: 'worker:one', role: 'worker', executor_attempt_id: null } };
}
test('pending, rejected and stale reviews block native admission', () => {
  for (const state of ['pending', 'rejected']) assert.throws(() => reviewAdmission({ ...fixture(state), mode: 'admit' }), /REVIEW_NOT_APPROVED/);
  const value = fixture(); value.snapshot.review_content_sha256 = 'c'.repeat(64);
  assert.throws(() => reviewAdmission({ ...value, mode: 'admit' }), /STALE_REVIEW_SUBJECT/);
});
test('native reservation admits one attempt and its distinct verifier continuation', () => {
  const value = fixture();
  assert.throws(() => reviewAdmission({ ...value, mode: 'observe' }), /REVIEW_ADMISSION_REQUIRED/);
  const admitted = reviewAdmission({ ...value, mode: 'admit' });
  assert.equal(admitted.changed, true); assert.equal(admitted.reviews[0].consumed_attempt_id, 'attempt:one');
  assert.equal(value.snapshot.state.reviews[0].state, 'approved');
  value.snapshot.state.reviews = admitted.reviews;
  assert.equal(reviewAdmission({ ...value, mode: 'observe' }).changed, false);
  assert.throws(() => reviewAdmission({ ...value, mode: 'inspect' }), /REVIEW_ALREADY_CONSUMED/);
  assert.throws(() => reviewAdmission({ ...value, mode: 'admit' }), /REVIEW_ALREADY_CONSUMED/);
  assert.throws(() => reviewAdmission({ ...value, request: { ...value.request, attempt_id: 'attempt:other' }, mode: 'admit' }), /REVIEW_ALREADY_CONSUMED/);
  const verifier = { ...value.request, attempt_id: 'attempt:verify', worker_id: 'worker:verify', role: 'verifier', executor_attempt_id: 'attempt:one' };
  const verified = reviewAdmission({ ...value, request: verifier, mode: 'admit' });
  assert.equal(verified.changed, true); value.snapshot.state.reviews = verified.reviews;
  assert.throws(() => reviewAdmission({ ...value, request: { ...verifier, attempt_id: 'another:verifier' }, mode: 'admit' }), /REVIEW_ALREADY_CONSUMED/);
  assert.throws(() => reviewAdmission({ ...value, request: { ...verifier, executor_attempt_id: 'attempt:wrong' }, mode: 'admit' }), /REVIEW_ALREADY_CONSUMED/);
});
test('unreviewed criteria retain their native dispatch behavior', () => {
  const value = fixture(); value.request = { ...value.request, review_id: null, subject: null, criterion_id: 'C2' };
  assert.equal(reviewAdmission({ ...value, mode: 'inspect' }).binding, null);
});
