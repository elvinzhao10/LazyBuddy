import { createRequire } from 'node:module';
import { capturedCompletion } from '../commands.mjs';
import { registerCompletionProof } from '../completion-proof.mjs';
const require = createRequire(import.meta.url);
export function readBuddyCompletion(input, options) {
  const { assessCapturedCompletion } = require('../../../scripts/completion-assessment.js');
  const bundle = capturedCompletion(input);
  const assessment = assessCapturedCompletion(bundle, { ...options, remediationCommand: 'show_run_status' });
  const matches = !assessment.authority || (bundle.current.head === input.source_revision &&
    assessment.authority.plan.path === input.state.plan_reference && assessment.authority.plan.sha256 === input.plan_digest);
  const result = matches ? assessment : { status: 'blocked', reason_code: 'CAPTURE_BINDING_MISMATCH' };
  const proof = Object.freeze({ status: result.status, reason: result.reason_code });
  if (result.authority) registerCompletionProof(proof, input, result.authority);
  return proof;
}
