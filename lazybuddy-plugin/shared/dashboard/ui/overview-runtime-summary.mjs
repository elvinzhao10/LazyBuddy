import { button, element, statusChip } from './components.mjs';

export function createOverviewRuntimeSummary({ telemetry, onNavigate }) {
  const operations = element('section', 'panel stack overview-operations');
  operations.dataset.testid = 'runtime-summary';
  operations.append(element('h2', '', 'Harness activity'));
  const usage = telemetry?.usage;
  const measures = element('div', 'overview-runtime-metrics');
  for (const [label, value, detail] of [
    ['Reported tokens', usage?.total_tokens == null ? 'Not reported' : usage.total_tokens.toLocaleString(), usage
      ? `${usage.coverage.requests_with_usage} of ${usage.coverage.distinct_request_ids} recorded requests · ${usage.complete ? 'complete for reported requests' : 'partial accounting'}`
      : 'The bound runtime has not provided structured usage records.'],
    ['Running tasks', telemetry?.tasks?.running ?? 'Not observed', telemetry?.run_id ? `Bound run ${telemetry.run_id}` : 'No bound run observation.'],
    ['Problems', telemetry && !telemetry.unavailable ? telemetry.problems_total : 'Not observed', 'Recorded failures, blocked tasks, source problems and runtime issues.'],
  ]) {
    const metric = element('div', 'stack');
    const figure = element('strong', '', String(value)); figure.dataset.numeric = 'true';
    metric.append(element('span', 'meta', label), figure, element('p', 'meta', detail)); measures.append(metric);
  }
  operations.append(measures);
  if (telemetry?.agent_attempts?.length) {
    const agents = element('details', '');
    agents.append(element('summary', '', `Recorded agent attempts (${telemetry.agent_attempts.length} of ${telemetry.agent_attempts_total})`));
    for (const attempt of telemetry.agent_attempts) {
      const row = element('div', 'stack');
      row.append(button(`${attempt.worker_id ?? 'Unidentified worker'} · ${attempt.task_id}`, () => onNavigate?.('execution')),
        statusChip({ state: attempt.execution === 'running' ? 'active' : attempt.execution === 'failed' ? 'failed' : 'neutral', label: `Execution ${attempt.execution}` }),
        element('p', 'meta', `Verification ${attempt.verification} · attempt ${attempt.id} · source ${attempt.source_revision ?? 'unreported'}`));
      agents.append(row);
    }
    operations.append(agents);
  }
  if (telemetry?.unavailable) operations.append(element('p', 'meta', `Runtime summary unavailable (${telemetry.code}). Project navigation remains available.`));
  if (telemetry?.problems?.length) {
    const problems = element('details', 'overview-problems');
    problems.open = telemetry.problems_total <= 5; problems.append(element('summary', '', `Problems to inspect (${telemetry.problems_total})`));
    const items = element('ul', 'stack');
    for (const problem of telemetry.problems) {
      const item = element('li', 'stack');
      item.append(button(problem.title, () => onNavigate?.(problem.destination)),
        element('code', 'meta', problem.id), element('p', 'meta', problem.detail)); items.append(item);
    }
    problems.append(items);
    if (telemetry.problems.length < telemetry.problems_total) problems.append(element('p', 'meta', `Showing ${telemetry.problems.length} of ${telemetry.problems_total} problems. Inspect the run and registered sources for the complete records.`));
    operations.append(problems);
  }
  if (telemetry?.usage_reports?.length) {
    const reports = element('details', ''); reports.append(element('summary', '', `Recorded usage reports (${telemetry.usage_reports.length} of ${telemetry.usage_reports_total})`));
    for (const report of telemetry.usage_reports) reports.append(element('code', 'meta', report.id), element('p', '', report.text),
      element('p', 'meta', `${report.observed_at} · ${report.reference}${report.truncated ? ' · Preview limited to 4,000 characters; open the registered record for the full report.' : ''}`));
    operations.append(reports);
  }
  const actions = element('div', 'cluster');
  for (const [id, label] of [['project', 'Edit project and requirements'], ['plans', 'Browse plans'], ['execution', 'Run and verification controls'],
    ['health', 'Inspect harness components'], ['git', 'Git and detailed metrics'], ['evidence', 'Inspect evidence']]) {
    actions.append(button(label, () => onNavigate?.(id)));
  }
  operations.append(actions, element('p', 'meta', telemetry?.coverage ?? 'Runtime observations are not connected to this preview.'));
  return operations;
}
