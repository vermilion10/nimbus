// Apply the saved style before first paint so the page doesn't flash.
try {
  var t = JSON.parse(localStorage.getItem('cloud-ui:theme') || '{}')
  document.documentElement.dataset.style = t.style || 'md3'
  document.documentElement.dataset.mode = t.mode || 'system'
} catch (e) {
  document.documentElement.dataset.style = 'md3'
  document.documentElement.dataset.mode = 'system'
}
