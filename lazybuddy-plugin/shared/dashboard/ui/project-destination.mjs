import { element } from './components.mjs';
import { createProjectEditor } from './editor-views.mjs';
import { createArchitectureView } from './architecture-view.mjs';
import { createLazyDetail } from './project-view-primitives.mjs';
export function createProjectView(project, { adapter }) {
  const root = element('section', 'project-native-editor stack');
  const head = element('header', 'stack');
  // The shell page header carries the destination title (T20a); the view
  // leads with its own scope note instead of a duplicate heading.
  head.append(element('p', 'meta',
    'Features, requirements, principles, decisions, plans and registered originals share the native revision-checked command route.'));
  const editor = createProjectEditor({ snapshot: project,
    sendCommand: command => adapter.command(command),
    captureSource: sourceId => adapter.source(sourceId),
    assessTransition: (snapshot, planId, toLifecycle, payload) => adapter.assessTransition(snapshot, planId, toLifecycle, payload),
  });
  const architecture = createLazyDetail({ label: 'Architecture', load: () => adapter.detail('architecture'),
    compose: fixture => createArchitectureView({ fixture,
      lens: fixture.journeys?.length ? 'product' : 'engineering',
      view: fixture.current?.length ? 'current' : 'planned',
      mode: typeof matchMedia === 'function' && matchMedia('(max-width: 48rem)').matches ? 'list' : 'graph' }) });
  architecture.update(project);
  const summary = element('section', 'grid project-summary');
  const summaryValues = new Map();
  for (const [label, key] of [['Features', 'accepted_features'], ['Requirements', 'accepted_requirements'],
    ['Principles', 'accepted_principles'], ['Decisions', 'accepted_decisions'], ['Plans', 'plan_count']]) {
    const value = element('strong', '', String(project.summary[key]));
    value.dataset.numeric = 'true'; summaryValues.set(key, value);
    const card = element('article', 'panel stack'); card.append(element('span', 'meta', label), value); summary.append(card);
  }
  const sourceDetails = element('details', 'panel stack project-source-details');
  sourceDetails.append(element('summary', '', 'Registered sources and structured editor'), editor.element);
  root.append(head, summary, architecture.element, sourceDetails);
  return { element: root, ready: editor.ready, update(next) {
    project = next; editor.update(next); architecture.update(next);
    for (const [key, value] of summaryValues) value.textContent = String(next.summary[key]);
  }, getState: () => editor.getState(),
  openEditor() { sourceDetails.open = true; sourceDetails.scrollIntoView?.({ block: 'start' }); sourceDetails.querySelector('summary')?.focus(); },
  // T20 navigation guard: the shell asks this surface before it replaces the
  // Project destination while the structured editor holds unsaved drafts.
  needsLeaveGuard: () => editor.needsLeaveGuard(),
  confirmLeave: options => editor.confirmLeave(options) };
}
