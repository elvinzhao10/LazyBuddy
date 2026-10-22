// Pre-paint appearance bootstrap (classic script, loaded from <head>):
// resolve the color scheme before first paint, then pre-apply the INTERNAL
// density state. V2-T1: compact/regular stopped being a stored user setting —
// data-density now follows the collapsed rail, so this pass derives it from
// the persisted shell navigation (a retracted rail must not flash in as
// regular before the shell mounts). The full native experience layer (focus
// system, segmented controls, tooltips) installs from components.mjs once
// the DOM is ready; the shell top bar's theme icon-toggle owns theme
// changes from there.
//
// T20-RF dark-first theming: DARK is the default when no preference is
// stored; a stored choice ('dark' | 'light' | 'system') always wins, a
// legacy #theme select (still present on some host pages) keeps all three
// options, and changes persist under 'lazyseries-theme' so a reload never
// flashes back to the default. Every storage access is guarded:
// blocked/private-mode storage degrades to the dark default for the
// session, never a throw.
var THEME_KEY = 'lazyseries-theme';
var THEME_VALUES = ['light', 'dark', 'system'];
var storedTheme = null;
try {
  storedTheme = localStorage.getItem(THEME_KEY);
} catch (error) {
  // localStorage unavailable (blocked or private mode): dark default, no throw.
}
var theme = THEME_VALUES.indexOf(storedTheme) !== -1 ? storedTheme : 'dark';
var systemDark = matchMedia('(prefers-color-scheme: dark)');
document.documentElement.dataset.theme = theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : theme;
try {
  var storedNav = JSON.parse(sessionStorage.getItem('lazybuddy-shell-nav') || 'null');
  document.documentElement.dataset.density = storedNav && storedNav.collapsed === true ? 'compact' : 'regular';
} catch (error) {
  // sessionStorage unavailable (blocked or private mode): regular density, no throw.
  document.documentElement.dataset.density = 'regular';
}
// A host page's legacy #theme select (V2-T1 removed it from the shell page;
// the served dashboard header still carries one until its own pass) stays
// functional: sync it to the resolved preference and persist changes.
var bindThemeControl = function () {
  var select = document.getElementById('theme');
  if (!select) return;
  select.value = theme;
  select.addEventListener('change', function () {
    theme = select.value;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* persistence unavailable: the choice lasts for the session only */
    }
    document.documentElement.dataset.theme = theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : theme;
  });
};
var bootNativeExperience = function () {
  import('./components.mjs')
    .then(function (native) { native.installNativeExperience(); })
    .catch(function () { /* the layer is progressive: pages still work without it */ });
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { bindThemeControl(); bootNativeExperience(); });
else { bindThemeControl(); bootNativeExperience(); }
