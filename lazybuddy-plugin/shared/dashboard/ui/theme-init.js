// Pre-paint appearance bootstrap (classic script, loaded from <head>):
// resolve the color scheme before first paint, then restore the persisted
// T11 density so compact mode never flashes in as regular. The full native
// experience layer (focus system, segmented controls, tooltips, density
// control) installs from components.mjs once the DOM is ready.
//
// T20-RF dark-first theming: DARK is the default when no preference is
// stored; a stored choice ('dark' | 'light' | 'system') always wins, the
// #theme control keeps all three options, and changes persist under
// 'lazyseries-theme' so a reload never flashes back to the default. Every
// storage access is guarded: blocked/private-mode storage degrades to the
// dark default for the session, never a throw.
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
  var storedDensity = localStorage.getItem('lazyseries-density');
  document.documentElement.dataset.density = storedDensity === 'compact' || storedDensity === 'regular' ? storedDensity : 'regular';
} catch (error) {
  // localStorage unavailable (blocked or private mode): regular density, no throw.
  document.documentElement.dataset.density = 'regular';
}
// The header's #theme control is the one appearance surface: sync it to the
// resolved preference and persist changes (index.mjs applies the same value
// on its own change listener, so both boot paths stay consistent).
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
