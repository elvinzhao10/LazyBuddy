// T03 spike fixtures — real-shape presentation documents for the four §7.2 levels.
// These are fixture data only: no live fields, no scheduler authority, no commands.
// Statuses use the design-system chip states (neutral/active/verified/attention/failed/stale/unavailable)
// and lifecycle vocabulary shared with the imported project contract (PLAN_LIFECYCLES).

const LABEL_LONG_PLAN = 'Feature extensions plan — depends on the active search plan delivering the shared index contract before any client work may start';
const LABEL_LONG_BATCH_TASK = 'Offline mirror task — replay the recorded change queue against the local index copy while the device is offline and report divergence per criterion version 2';
const LABEL_LONG_STEP = 'Crawl step — walk the registered source tree at content revision 42 and record every document anchor with its digest for the verifier';
const LABEL_LONG_BATCH = 'Batch — dashboard consumption surfaces including the saved-search list, the stale-state banners and the keyboard-only traversal path';

// Fixture status -> design-system chip state, mirroring the existing role maps in work-view.mjs.
// `unverified` maps to the design system's neutral verification semantics (work-view.mjs
// verificationRole); unknown statuses are rejected here instead of silently defaulting to neutral
// inside statusChip's `state` destructure.
const STATUS_STATES = Object.freeze({
  neutral: 'neutral', active: 'active', verified: 'verified', attention: 'attention',
  failed: 'failed', stale: 'stale', unavailable: 'unavailable', unverified: 'neutral',
});
const chip = (status, label) => {
  if (!Object.hasOwn(STATUS_STATES, status)) throw new TypeError(`Unknown fixture status: ${status}`);
  return { state: STATUS_STATES[status], label };
};

export function projectMapFixture() {
  return {
    viewId: 'project-map', level: 'project', docId: 'project-map:sample-app',
    title: 'Sample application repository', subtitle: 'Macro map · feature areas, plans, inter-plan dependencies and durable conflicts',
    statusSentence: {
      text: 'Delivery active on the search plan; one baseline decision pending; one verification gate blocking the next batch; Git changes not yet committed.',
      clauses: [
        { text: 'search plan active', ref: 'plan:search' },
        { text: 'verification gate blocking', ref: 'gate:wave-1' },
        { text: 'durable conflict open', ref: 'conflict:offline-vs-cloud' },
      ],
    },
    nodes: [
      { id: 'feature:offline-sync', kind: 'feature-area', title: 'Offline-first synchronization', summary: 'Accepted requirement REQ-7 keeps first-party features usable offline.', execution: chip('verified', 'Implemented · verified'), verification: chip('verified', 'Applicable proof v2'), meta: '2 plans contribute' },
      { id: 'feature:dashboard', kind: 'feature-area', title: 'Dashboard shell', summary: 'Work, proof and planning surfaces over observed state.', execution: chip('verified', 'Implemented'), verification: chip('verified', 'Applicable proof v1'), meta: '1 plan contributes' },
      { id: 'feature:installer', kind: 'feature-area', title: 'Installer safety', summary: 'Onboarding and offboarding preserve caller files.', execution: chip('neutral', 'Partially implemented'), verification: chip('stale', 'Proof stale after criterion change'), meta: '1 completed plan' },
      { id: 'plan:foundation', kind: 'plan', title: 'Foundation plan — persistent records and dashboard shell', summary: 'Lifecycle: completed. Historical result retained; current alignment unassessed.', execution: chip('neutral', 'Completed'), verification: chip('verified', 'Verified at revision 31'), meta: 'Completed · historical proof retained' },
      { id: 'plan:search', kind: 'plan', title: 'Active search plan — two worker branches with an independent verifier', summary: 'Lifecycle: active. One verification gate blocks the next batch.', execution: chip('active', 'Active'), verification: chip('attention', 'Gate blocking next batch'), meta: 'Active · plan revision 7', drill: 'plan:search' },
      { id: 'plan:feature-extensions', kind: 'plan', title: LABEL_LONG_PLAN, summary: 'Lifecycle: planned. Enters active denominators only at admission.', execution: chip('neutral', 'Planned'), verification: chip('unavailable', 'No verification yet'), meta: 'Future · waits on plan:search' },
      { id: 'plan:collab-explore', kind: 'plan', title: 'Collaboration exploration — mandatory cloud relay rollout', summary: 'Lifecycle: draft. Held by one durable conflict and one external prerequisite.', execution: chip('neutral', 'Draft'), verification: chip('unavailable', 'Not verified'), meta: 'Exploring · conflict open' },
      { id: 'conflict:offline-vs-cloud', kind: 'conflict', title: 'Durable conflict — accepted offline requirement versus mandatory-cloud dependency', summary: 'Requirement REQ-7 (accepted, revision 2) conflicts with the cloud relay prerequisite recorded by the exploration plan. Both sources cited; no automatic resolution.', execution: chip('attention', 'Open · reconciliation pending'), verification: chip('unavailable', 'Not applicable'), meta: 'Attention queue item 1' },
      { id: 'boundary:vendor-sdk', kind: 'boundary', title: 'External — vendor SDK license decision', summary: 'External dependency terminates here; the dashboard observes, it does not own it.', execution: chip('unavailable', 'External'), verification: chip('unavailable', 'Unknown'), meta: 'Boundary node' },
    ],
    edges: [
      { from: 'feature:offline-sync', to: 'plan:foundation', kind: 'group', label: 'feature area groups plan' },
      { from: 'feature:dashboard', to: 'plan:foundation', kind: 'group', label: 'feature area groups plan' },
      { from: 'feature:installer', to: 'plan:foundation', kind: 'group', label: 'feature area groups plan' },
      { from: 'feature:offline-sync', to: 'plan:search', kind: 'group', label: 'feature area groups plan' },
      { from: 'feature:offline-sync', to: 'plan:feature-extensions', kind: 'group', label: 'feature area groups plan' },
      { from: 'plan:foundation', to: 'plan:search', kind: 'dependency', label: 'inter-plan dependency: shared records contract' },
      { from: 'plan:search', to: 'plan:feature-extensions', kind: 'dependency', label: 'inter-plan dependency: index contract' },
      { from: 'boundary:vendor-sdk', to: 'plan:collab-explore', kind: 'external', label: 'external prerequisite' },
      { from: 'conflict:offline-vs-cloud', to: 'plan:collab-explore', kind: 'conflict', label: 'conflict blocks admission' },
      { from: 'conflict:offline-vs-cloud', to: 'feature:offline-sync', kind: 'conflict', label: 'cites accepted requirement' },
    ],
  };
}

export function planFixture(variant = 'search') {
  if (variant === 'collab') {
    return {
      viewId: 'plan:collab-explore', level: 'plan', docId: 'plan:collab-explore',
      title: 'Collaboration exploration plan', subtitle: 'Waves/batches/verification gates · exploring variant',
      plans: [{ id: 'plan:search', label: 'Active search plan' }, { id: 'plan:collab-explore', label: 'Collaboration exploration' }],
      nodes: [
        { id: 'wave:explore-1', kind: 'wave', title: 'Wave 1 — relay feasibility', summary: 'Two batches behind one verification gate.', execution: chip('neutral', 'Not started'), verification: chip('unavailable', 'No checks yet'), meta: 'Wave' },
        { id: 'batch:relay-probe', kind: 'batch', title: 'Batch — relay probe against a disposable sandbox (no caller data)', summary: 'Three worker tasks.', execution: chip('neutral', 'Not started'), verification: chip('unavailable', 'No checks yet'), meta: 'Batch' },
        { id: 'batch:conflict-review', kind: 'batch', title: 'Batch — conflict review with the accepted offline requirement', summary: 'Produces a reconciliation proposal; consumes no authority.', execution: chip('attention', 'Held'), verification: chip('unavailable', 'No checks yet'), meta: 'Batch' },
        { id: 'gate:explore-1', kind: 'gate', title: 'Verification gate — wave 1 (collapsed: 2 checks, 1 stale)', summary: 'Collapsed gate retains its pending/stale state.', execution: chip('neutral', 'Gate'), verification: chip('stale', '1 check stale'), meta: 'Collapsed group', collapsed: true, children: [
          { id: 'gate-check:probe-scenario', kind: 'gate-check', title: 'Check — sandbox probe scenario', summary: 'Verifier scenario references criterion version 1.', execution: chip('neutral', 'Recorded'), verification: chip('stale', 'Stale after criterion v2'), meta: 'Gate check' },
          { id: 'gate-check:privacy-review', kind: 'gate-check', title: 'Check — privacy review of relay payloads', summary: 'Pending reviewer input.', execution: chip('attention', 'Pending input'), verification: chip('unavailable', 'Unknown'), meta: 'Gate check' },
        ] },
        { id: 'conflict:offline-vs-cloud', kind: 'conflict', title: 'Durable conflict — accepted offline requirement versus mandatory-cloud dependency', summary: 'Blocks admission of wave 2 until reconciled through accepted authority.', execution: chip('attention', 'Open'), verification: chip('unavailable', 'Not applicable'), meta: 'Blocks wave 2' },
        { id: 'boundary:vendor-sdk', kind: 'boundary', title: 'External — vendor SDK license decision', summary: 'External prerequisite; observation only.', execution: chip('unavailable', 'External'), verification: chip('unavailable', 'Unknown'), meta: 'Boundary node' },
      ],
      edges: [
        { from: 'wave:explore-1', to: 'batch:relay-probe', kind: 'dependency', label: 'wave orders batch' },
        { from: 'wave:explore-1', to: 'batch:conflict-review', kind: 'dependency', label: 'wave orders batch' },
        { from: 'batch:relay-probe', to: 'gate:explore-1', kind: 'gate', label: 'gate verifies batch' },
        { from: 'batch:conflict-review', to: 'gate:explore-1', kind: 'gate', label: 'gate verifies batch' },
        { from: 'conflict:offline-vs-cloud', to: 'gate:explore-1', kind: 'conflict', label: 'conflict qualifies gate result' },
        { from: 'boundary:vendor-sdk', to: 'batch:relay-probe', kind: 'external', label: 'external prerequisite' },
      ],
    };
  }
  return {
    viewId: 'plan:search', level: 'plan', docId: 'plan:search',
    title: 'Active search plan', subtitle: 'Waves/batches/verification gates · active variant',
    plans: [{ id: 'plan:search', label: 'Active search plan' }, { id: 'plan:collab-explore', label: 'Collaboration exploration' }],
    nodes: [
      { id: 'wave:1', kind: 'wave', title: 'Wave 1 — index foundation', summary: 'Two batches behind one verification gate.', execution: chip('neutral', 'In progress'), verification: chip('attention', 'Gate blocking'), meta: 'Wave' },
      { id: 'batch:index-build', kind: 'batch', title: 'Batch — build the shared search index (three worker tasks)', summary: 'Two worker branches and an independent verifier stage.', execution: chip('active', 'Executing'), verification: chip('active', 'Verifying'), meta: 'Batch', drill: 'batch:index-build' },
      { id: 'batch:offline-queue', kind: 'batch', title: 'Batch — offline change queue', summary: 'Records local mutations while offline.', execution: chip('neutral', 'Not started'), verification: chip('unavailable', 'No checks yet'), meta: 'Batch' },
      { id: 'gate:wave-1', kind: 'gate', title: 'Verification gate — wave 1 (collapsed: 3 checks, 1 pending)', summary: 'Collapsed group still reveals the pending check that blocks wave 2.', execution: chip('neutral', 'Gate'), verification: chip('attention', '1 check pending'), meta: 'Collapsed group', collapsed: true, children: [
        { id: 'gate-check:unit-suite', kind: 'gate-check', title: 'Check — index unit suite', summary: 'Passed at criterion version 2.', execution: chip('neutral', 'Recorded'), verification: chip('verified', 'Verified · v2'), meta: 'Gate check' },
        { id: 'gate-check:integration-scenario', kind: 'gate-check', title: 'Check — integration scenario: rebuild from retained sources', summary: 'Verifier executed at content revision 40.', execution: chip('neutral', 'Recorded'), verification: chip('verified', 'Verified · v2'), meta: 'Gate check' },
        { id: 'gate-check:browser-smoke', kind: 'gate-check', title: 'Check — browser smoke over the packaged dashboard', summary: 'Waiting for the offline mirror branch; cannot be satisfied by upstream execution alone.', execution: chip('attention', 'Waiting'), verification: chip('attention', 'Pending'), meta: 'Gate check' },
      ] },
      { id: 'wave:2', kind: 'wave', title: 'Wave 2 — client consumption', summary: 'Blocked until the wave 1 gate passes.', execution: chip('neutral', 'Blocked'), verification: chip('unavailable', 'No checks yet'), meta: 'Wave' },
      { id: 'batch:client-ui', kind: 'batch', title: LABEL_LONG_BATCH, summary: 'Consumes the index contract delivered by wave 1.', execution: chip('neutral', 'Not started'), verification: chip('unavailable', 'No checks yet'), meta: 'Batch' },
      { id: 'gate:release', kind: 'gate', title: 'Verification gate — release (collapsed: 2 checks, 1 stale)', summary: 'A criterion change made one earlier result stale.', execution: chip('neutral', 'Gate'), verification: chip('stale', '1 check stale'), meta: 'Collapsed group', collapsed: true, children: [
        { id: 'gate-check:release-report', kind: 'gate-check', title: 'Check — release verification report', summary: 'Published at criterion version 1.', execution: chip('neutral', 'Recorded'), verification: chip('stale', 'Stale after criterion v2'), meta: 'Gate check' },
        { id: 'gate-check:docs-audit', kind: 'gate-check', title: 'Check — documentation audit', summary: 'Passed at criterion version 2.', execution: chip('neutral', 'Recorded'), verification: chip('verified', 'Verified · v2'), meta: 'Gate check' },
      ] },
      { id: 'boundary:vendor-sdk', kind: 'boundary', title: 'External — vendor SDK license decision', summary: 'Wave 2 signing waits on this external decision.', execution: chip('unavailable', 'External'), verification: chip('unavailable', 'Unknown'), meta: 'Boundary node' },
    ],
    edges: [
      { from: 'wave:1', to: 'batch:index-build', kind: 'dependency', label: 'wave orders batch' },
      { from: 'wave:1', to: 'batch:offline-queue', kind: 'dependency', label: 'wave orders batch' },
      { from: 'batch:index-build', to: 'gate:wave-1', kind: 'gate', label: 'gate verifies batch' },
      { from: 'batch:offline-queue', to: 'gate:wave-1', kind: 'gate', label: 'gate verifies batch' },
      { from: 'gate:wave-1', to: 'wave:2', kind: 'dependency', label: 'gate blocks wave 2 while a check is pending' },
      { from: 'wave:2', to: 'batch:client-ui', kind: 'dependency', label: 'wave orders batch' },
      { from: 'batch:client-ui', to: 'gate:release', kind: 'gate', label: 'gate verifies batch' },
      { from: 'boundary:vendor-sdk', to: 'batch:client-ui', kind: 'external', label: 'external prerequisite gates signing' },
    ],
  };
}

export function batchFixture() {
  return {
    viewId: 'batch:index-build', level: 'batch', docId: 'batch:index-build',
    title: 'Batch — build the shared search index', subtitle: 'Worker tasks, parallel branches, verifier stage and join · nested fan-out/fan-in',
    nodes: [
      { id: 'task:index-plan', kind: 'task', title: 'Plan the index build', summary: 'Registers scope and criteria; produces no execution claim.', execution: chip('neutral', 'Finished'), verification: chip('verified', 'Verified · v1'), meta: 'Worker task' },
      { id: 'task:index-crawl', kind: 'task', title: 'Crawl registered sources', summary: 'Runs on branch A.', execution: chip('active', 'Running · attempt 2'), verification: chip('unverified', 'Unverified'), meta: 'Worker task · branch A', drill: 'task:index-crawl' },
      { id: 'task:index-parse', kind: 'task', title: 'Parse and normalize documents', summary: 'Runs on branch A in parallel with the crawl.', execution: chip('neutral', 'Finished'), verification: chip('verified', 'Verified · v2'), meta: 'Worker task · branch A' },
      { id: 'task:index-offline-mirror', kind: 'task', title: LABEL_LONG_BATCH_TASK, summary: 'Runs on branch B.', execution: chip('active', 'Running · attempt 1'), verification: chip('unverified', 'Unverified'), meta: 'Worker task · branch B' },
      { id: 'verifier:content-check', kind: 'verifier', title: 'Verifier — content checks (expandable)', summary: 'Independent verifier on branch A. Reported steps are shown; unreported steps stay unknown.', execution: chip('active', 'Verifying'), verification: chip('verified', 'Branch A confirmed'), meta: 'Verifier stage · branch A', children: [
        { id: 'verifier-step:claim-review', kind: 'gate-check', title: 'Verifier step — claim review', summary: 'Reviewed the completion claim against criteria.', execution: chip('neutral', 'Recorded'), verification: chip('verified', 'Done'), meta: 'Verifier step' },
        { id: 'verifier-step:command-run', kind: 'gate-check', title: 'Verifier step — command/test run', summary: 'Ran the index unit suite at content revision 41.', execution: chip('neutral', 'Recorded'), verification: chip('verified', 'Done'), meta: 'Verifier step' },
      ] },
      { id: 'verifier:offline-check', kind: 'verifier', title: 'Verifier — offline mirror checks', summary: 'Independent verifier on branch B; checks still running.', execution: chip('active', 'Verifying'), verification: chip('active', 'Checks pending'), meta: 'Verifier stage · branch B' },
      { id: 'join:batch-complete', kind: 'join', title: 'Join — batch complete', summary: 'Join condition: all branches confirmed. Branch A confirmed, branch B pending, so the join stays blocked.', execution: chip('attention', 'Blocked'), verification: chip('unavailable', 'Waiting on branch B'), meta: 'Join · requires all' },
    ],
    edges: [
      { from: 'task:index-plan', to: 'task:index-crawl', kind: 'dependency', label: 'unlocks after planning' },
      { from: 'task:index-plan', to: 'task:index-parse', kind: 'dependency', label: 'unlocks after planning' },
      { from: 'task:index-plan', to: 'task:index-offline-mirror', kind: 'dependency', label: 'unlocks after planning' },
      { from: 'task:index-crawl', to: 'verifier:content-check', kind: 'gate', label: 'branch A fan-in to verifier' },
      { from: 'task:index-parse', to: 'verifier:content-check', kind: 'gate', label: 'branch A fan-in to verifier' },
      { from: 'task:index-offline-mirror', to: 'verifier:offline-check', kind: 'gate', label: 'branch B into verifier' },
      { from: 'verifier:content-check', to: 'join:batch-complete', kind: 'dependency', label: 'join condition branch A: confirmed' },
      { from: 'verifier:offline-check', to: 'join:batch-complete', kind: 'dependency', label: 'join condition branch B: pending' },
    ],
  };
}

export function attemptFixture() {
  return {
    viewId: 'task:index-crawl', level: 'attempt', docId: 'task:index-crawl',
    title: 'Task — crawl registered sources', subtitle: 'Attempts, steps and evidence production · retry history without a plan-DAG cycle',
    nodes: [
      { id: 'attempt:1', kind: 'attempt', title: 'Attempt 1 — failed verification (history)', summary: 'Execution finished, verification failed; result retained as history.', execution: chip('failed', 'Finished'), verification: chip('failed', 'Failed'), meta: 'Historical attempt', layoutAfter: null },
      { id: 'attempt:2', kind: 'attempt', title: 'Attempt 2 — running after repair', summary: 'Current attempt. Repair addressed the failed check; no earlier result was overwritten.', execution: chip('active', 'Running'), verification: chip('unverified', 'Unverified'), meta: 'Current attempt', layoutAfter: 'attempt:1' },
      { id: 'step:plan', kind: 'step', title: 'Step 1 — load the registered source scope', summary: 'Reads the registered original documents.', execution: chip('neutral', 'Finished'), verification: chip('verified', 'Receipt kept'), meta: 'Attempt 2 · step' },
      { id: 'step:crawl', kind: 'step', title: LABEL_LONG_STEP, summary: 'Current step.', execution: chip('active', 'Running'), verification: chip('unverified', 'Unverified'), meta: 'Attempt 2 · step' },
      { id: 'step:evidence', kind: 'step', title: 'Step 3 — produce crawl evidence', summary: 'Writes the crawl report artifact.', execution: chip('neutral', 'Not started'), verification: chip('unavailable', 'Not yet'), meta: 'Attempt 2 · step' },
      { id: 'evidence:crawl-report-2', kind: 'evidence', title: 'Evidence — crawl-report.json (attempt 2, pending)', summary: 'Will be produced by step 3; not yet available.', execution: chip('unavailable', 'Pending'), verification: chip('unavailable', 'Not yet produced'), meta: 'Artifact · registered path pending' },
      { id: 'evidence:crawl-report-1', kind: 'evidence', title: 'Evidence — crawl-report.json (attempt 1, stale)', summary: 'Historical artifact of the failed attempt; kept, not reused as current proof.', execution: chip('neutral', 'Recorded'), verification: chip('stale', 'Stale · failed attempt'), meta: 'Artifact · evidence/reports/crawl-report-1.json' },
    ],
    edges: [
      { from: 'attempt:2', to: 'step:plan', kind: 'dependency', label: 'attempt starts steps' },
      { from: 'step:plan', to: 'step:crawl', kind: 'dependency', label: 'step order' },
      { from: 'step:crawl', to: 'step:evidence', kind: 'dependency', label: 'step order' },
      { from: 'step:evidence', to: 'evidence:crawl-report-2', kind: 'dependency', label: 'step produces evidence' },
      { from: 'attempt:1', to: 'evidence:crawl-report-1', kind: 'dependency', label: 'failed attempt produced historical evidence' },
      { from: 'attempt:1', to: 'attempt:2', kind: 'history', label: 'retry — new attempt after failed verification; the plan dependency DAG gains no cycle' },
    ],
  };
}

export const spikeFixtures = [
  { key: 'project', label: 'Project map', build: projectMapFixture },
  { key: 'plan', label: 'Plan', build: () => planFixture('search') },
  { key: 'batch', label: 'Batch', build: batchFixture },
  { key: 'attempt', label: 'Attempt', build: attemptFixture },
];
