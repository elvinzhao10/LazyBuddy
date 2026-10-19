// Pre-paint appearance bootstrap (classic script, loaded from <head>):
// resolve the color scheme before first paint, then restore the persisted
// T11 density so compact mode never flashes in as regular. The full native
// experience layer (focus system, segmented controls, tooltips, density
// control) installs from components.mjs once the DOM is ready.
document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
try {
  var storedDensity = localStorage.getItem('lazyseries-density');
  document.documentElement.dataset.density = storedDensity === 'compact' || storedDensity === 'regular' ? storedDensity : 'regular';
} catch (error) {
  // localStorage unavailable (blocked or private mode): regular density, no throw.
  document.documentElement.dataset.density = 'regular';
}
var bootNativeExperience = function () {
  import('./components.mjs')
    .then(function (native) { native.installNativeExperience(); })
    .catch(function () { /* the layer is progressive: pages still work without it */ });
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootNativeExperience);
else bootNativeExperience();
