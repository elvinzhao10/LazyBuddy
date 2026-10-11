// T17 architecture demo page — fixture-only consumer of createArchitectureView.
// Loads the fixture JSON built by the T17 test through the real data path
// (T02 CLI command route over a real disposable git repository -> T11 local-git
// collector -> T13 projectArchitecture/productJourney via the T17 adapter) and
// renders it with the browser-safe view module. Serves both lenses, all three
// views, cards/list modes, theme switching and a simulated polling tick used by
// the browser evidence harness.
import { createArchitectureView } from './architecture-view.mjs';

const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const themeControl = document.querySelector('#theme');
function updateTheme() {
  document.documentElement.dataset.theme = themeControl.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : themeControl.value;
}
themeControl.addEventListener('change', updateTheme);
systemTheme.addEventListener('change', updateTheme);
themeControl.disabled = false;

const root = document.querySelector('#architecture-root');
const loadStatus = document.querySelector('#load-status');
const narrow = matchMedia('(max-width: 48rem)');
let view = null;
let fixture = null;
let updateFixture = null;

function mount(data, mode) {
  if (view) view.element.remove();
  view = createArchitectureView({ fixture: data, lens: 'product', view: 'current', mode });
  root.append(view.element);
}

// Narrow widths get the equivalent list mode; switching back restores cards.
function applyWidth() {
  if (!view) return;
  const wanted = narrow.matches ? 'list' : 'cards';
  if (view.getStats().mode !== wanted) view.setMode(wanted);
}

window.__architectureTick = function tick() {
  if (!view || !updateFixture) return null;
  return view.applyUpdate(updateFixture);
};

window.__architectureStats = () => view?.getStats() ?? null;

(async function load() {
  const response = await fetch('./architecture-fixture.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`fixture unreadable: ${response.status}`);
  const payload = await response.json();
  fixture = payload.initial;
  updateFixture = payload.update;
  mount(fixture, narrow.matches ? 'list' : 'cards');
  narrow.addEventListener('change', applyWidth);
  loadStatus.textContent = 'Architecture fixture ready.';
  document.documentElement.dataset.architectureReady = 'true';
})().catch(error => {
  loadStatus.textContent = `The architecture fixture failed to load: ${error?.message ?? error}`;
  clearTimeout(loadTimeout);
  throw error;
});
