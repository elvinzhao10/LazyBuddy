// T19 evidence demo page — fixture-only consumer of createEvidenceView.
// Loads the fixture JSON built by the T19 test through the real data path
// (T12 CLI registration route -> buildArtifactIndex -> evidenceFixture -> the
// view) and replays the honest pages T12's paginate produced (the browser
// cannot import the Node-side artifact package, so it never recomputes a
// total). Safe previews replay the recorded renderArtifactPreview outputs.
// Serves scope navigation, pagination, previews, research display, theme
// switching, narrow list mode and a simulated polling tick used by the
// browser evidence harness.
import { createEvidenceView } from './evidence-view.mjs';
import { installNativeExperience } from './components.mjs';

installNativeExperience(); // T11: keyboard/focus/density layer, idempotent

const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const themeControl = document.querySelector('#theme');
function updateTheme() {
  document.documentElement.dataset.theme = themeControl.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : themeControl.value;
}
themeControl.addEventListener('change', updateTheme);
systemTheme.addEventListener('change', updateTheme);
themeControl.disabled = false;

const root = document.querySelector('#evidence-root');
const loadStatus = document.querySelector('#load-status');
const narrow = matchMedia('(max-width: 48rem)');
let view = null;
let fixture = null;
let updateFixture = null;

// Honest page replay: the requested page is clamped to the recorded page count
// before lookup and the clamp is reported — no total is ever recomputed here.
function pageFromFixture(source, nav, page) {
  const key = nav.scope === 'global' ? 'global' : `${nav.scope}:${nav.id}`;
  const recorded = source.scopePages[key];
  if (!recorded) return { entries: [], total: 0, page, page_size: 50, page_count: 1, has_next: false,
    truncated: false, coverage: { total: 0, by_status: {}, truncation: 'none' } };
  const requested = Math.max(1, Number.isSafeInteger(page) ? page : 1);
  const clamped = Math.min(requested, recorded.page_count);
  const chosen = recorded.pages.find(candidate => candidate.page === clamped);
  return { ...chosen, nav };
}

function mount(data, mode) {
  if (view) view.element.remove();
  view = createEvidenceView({
    fixture: data,
    mode,
    loadPage: (source, nav, page) => pageFromFixture(source, nav, page),
    loadPreview: async entry => data.previews?.[entry.id]
      ?? { artifact_id: entry.id, kind: entry.preview?.kind ?? null, available: false,
        reason: 'preview_not_recorded', original: { path: entry.path, link: entry.path },
        status: entry.status, sanitized: true },
  });
  root.append(view.element);
}

// Narrow widths get the equivalent list mode; switching back restores cards.
function applyWidth() {
  if (!view) return;
  const wanted = narrow.matches ? 'list' : 'cards';
  if (view.getStats().mode !== wanted) view.setMode(wanted);
}

window.__evidenceTick = function tick() {
  if (!view || !updateFixture) return null;
  return Promise.resolve(view.applyUpdate({ ...updateFixture, previews: fixture.previews,
    scopePages: updateFixture.scopePages }));
};

window.__evidenceStats = () => view?.getStats() ?? null;

(async function load() {
  const response = await fetch('./evidence-fixture.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`fixture unreadable: ${response.status}`);
  const payload = await response.json();
  fixture = { ...payload.initial, previews: payload.previews };
  updateFixture = payload.update;
  mount(fixture, narrow.matches ? 'list' : 'cards');
  narrow.addEventListener('change', applyWidth);
  loadStatus.textContent = 'Evidence fixture ready.';
  document.documentElement.dataset.evidenceReady = 'true';
})().catch(error => {
  loadStatus.textContent = `The evidence fixture failed to load: ${error?.message ?? error}`;
  clearTimeout(loadTimeout);
  throw error;
});
