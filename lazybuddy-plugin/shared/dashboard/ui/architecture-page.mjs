// T17 architecture demo page — fixture-only consumer of createArchitectureView,
// mounted inside the T12b shell frame: a sidebar rail (Architecture current),
// a pinned tabbed workspace for the lenses, and the view's own component
// detail dock. Loads the fixture JSON built by the T17 test through the real
// data path (T02 CLI command route over a real disposable git repository ->
// T11 local-git collector -> T13 projectArchitecture/productJourney via the
// T17 adapter) and renders it with the browser-safe view module. Serves both
// perspectives, all three lens tabs, cards/list modes, theme switching and a
// simulated polling tick used by the browser evidence harness.
import { createArchitectureView } from './architecture-view.mjs';
import { button, element, installNativeExperience, createTabs, sidebarNav, statusChip } from './components.mjs';

installNativeExperience(); // T11: keyboard/focus/density layer, idempotent

const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const themeControl = document.querySelector('#theme');
function updateTheme() {
  document.documentElement.dataset.theme = themeControl.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : themeControl.value;
}
themeControl.addEventListener('change', updateTheme);
systemTheme.addEventListener('change', updateTheme);
themeControl.disabled = false;

// Dock trigger, same affordance as the T12b shell header: opens the component
// detail dock (its empty state explains what fills it) without a selection.
const dockTrigger = button('Detail dock', () => {
  if (!view) return;
  const open = view.getStats().dockOpen ? (view.closeDock(), false) : view.openDock(dockTrigger);
  dockTrigger.setAttribute('aria-pressed', String(open));
});
dockTrigger.dataset.testid = 'architecture-dock-trigger';
dockTrigger.setAttribute('aria-pressed', 'false');
dockTrigger.setAttribute('aria-label', 'Toggle the component detail dock');
document.querySelector('#shell-controls')?.append(dockTrigger);

const root = document.querySelector('#architecture-root');
const loadStatus = document.querySelector('#load-status');
const narrow = matchMedia('(max-width: 48rem)');
let view = null;
let fixture = null;
let updateFixture = null;
const openedItems = [];

// The shell frame (T12 library pieces): destinations rail + tabbed
// workspace. Only the Architecture destination has data on this fixture page;
// the others render the explicit unavailable state, never a disabled control.
// `?product=<runtime>` previews the page under another family runtime — the
// identity surfaces (sidebar badge, runtime label) swap their accent from the
// real per-product tokens; nothing status-like recolors (audit CL-5).
const previewRuntime = new URLSearchParams(location.search).get('product');
const tabs = createTabs({ onChange: (tabId, kind) => {
  if (kind === 'select' && tabId !== 'architecture' && !tabId.startsWith('item:')) selectDestination(tabId);
} });
const sidebar = sidebarNav({
  product: 'LazySeries', runtime: previewRuntime ?? 'LazyBuddy', current: 'architecture',
  destinations: [{ id: 'overview', label: 'Overview' }, { id: 'architecture', label: 'Architecture' }],
  footer: element('p', 'meta', 'Fixture page — the live workspace projects the whole record.'),
  onNavigate: id => selectDestination(id),
});
// Narrow widths collapse the rail to its icon column (the shell convention);
// wide widths restore the labeled rail.
sidebar.setCollapsed(narrow.matches, { notify: false });

function destinationPanel(id) {
  if (id === 'architecture') return view?.element ?? element('p', 'meta', 'Loading architecture fixture…');
  const panel = element('section', 'panel notice stack');
  panel.append(statusChip({ state: 'unavailable', label: `${id} unavailable` }),
    element('p', 'meta', `This fixture page carries only the architecture projection; the ${id} destination has no data here. Nothing is inferred in its place (honesty rule).`));
  return panel;
}

function selectDestination(id) {
  if (view && id === 'architecture' && !tabs.tabs().includes('architecture')) {
    tabs.openTab({ id: 'architecture', title: 'Architecture', pinned: true });
  }
  for (const other of ['overview', 'architecture']) {
    if (other !== id) tabs.closeTab(other);
  }
  if (!tabs.tabs().includes(id)) tabs.openTab({ id, title: id === 'architecture' ? 'Architecture' : 'Overview' });
  tabs.select(id);
  sidebar.navigate(id);
}

// Every onOpenItem link opens its item tab — the same contract the live
// shell fulfills with the real plan/decision/evidence views.
function openItemTab({ kind, id }) {
  const tabId = `item:${kind}:${id}`;
  if (!tabs.tabs().includes(tabId)) {
    const stub = element('section', 'panel stack');
    stub.append(element('h2', '', `${kind} — ${id}`),
      element('p', 'meta', 'This fixture demo opens the recorded item in its own tab; the live workspace renders the real item view here.'));
    tabs.openTab({ id: tabId, title: `${kind} · ${id}`, content: stub });
    openedItems.push(tabId);
  }
  tabs.select(tabId);
}

function mount(data, mode) {
  if (view) view.element.remove();
  view = createArchitectureView({ fixture: data, perspective: 'product', lens: 'current', mode,
    callbacks: { onOpenItem: openItemTab } });
  const host = tabs.panels.querySelector('[data-tab-id="architecture"]') ?? null;
  if (host) host.replaceChildren(view.element);
}

// Narrow widths get the equivalent list mode and the icon rail; switching
// back restores the graph mode and the labeled rail.
function applyWidth() {
  sidebar.setCollapsed(narrow.matches, { notify: false });
  if (!view) return;
  const wanted = narrow.matches ? 'list' : 'graph';
  if (view.getStats().mode !== wanted) view.setMode(wanted);
}

window.__architectureTick = function tick() {
  if (!view || !updateFixture) return null;
  return view.applyUpdate(updateFixture);
};

window.__architectureStats = () => view?.getStats() ?? null;
window.__architectureOpenedItems = () => [...openedItems];

(async function load() {
  const response = await fetch('./architecture-fixture.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`fixture unreadable: ${response.status}`);
  const payload = await response.json();
  fixture = payload.initial;
  updateFixture = payload.update;
  const workspace = element('div', 'lb-shell');
  const main = element('div', 'lb-shell-main');
  main.append(tabs.element);
  workspace.append(sidebar.element, main);
  root.append(workspace);
  tabs.openTab({ id: 'architecture', title: 'Architecture', pinned: true });
  mount(fixture, narrow.matches ? 'list' : 'graph');
  narrow.addEventListener('change', applyWidth);
  loadStatus.textContent = 'Architecture fixture ready.';
  document.documentElement.dataset.architectureReady = 'true';
})().catch(error => {
  loadStatus.textContent = `The architecture fixture failed to load: ${error?.message ?? error}`;
  clearTimeout(loadTimeout);
  throw error;
});
