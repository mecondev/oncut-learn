// Runs before the page paints (a classic script in <head>, not a module), so
// the chosen OS hides the other platforms' blocks without a flash. Kept as a
// file because the CSP allows no inline script. Logic mirrors src/player/os.ts.
(function () {
  var root = document.documentElement
  root.classList.add('js')
  try {
    var os = localStorage.getItem('oncut-learn:os')
    if (os === 'windows' || os === 'linux' || os === 'macos') root.dataset.os = os
  } catch (e) {
    // storage blocked: every platform block stays visible
  }
})()
