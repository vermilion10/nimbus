// Settings for this installation. The server replaces this file with its own copy
// (see deploy/compose.yaml), so the app itself needs no rebuild to change them.
window.CLOUD_CONFIG = {
  // Address of Nextcloud's own web interface, for the "Open Nextcloud" menu item.
  // Leave empty to hide the item.
  nextcloudUrl: '',

  // Sharing through a separately published folder (for example a static file
  // server that serves a Nextcloud folder read-only). Items inside `publicDir`
  // get a link `publicBase + path inside the folder`. Leave `publicBase` empty to
  // turn sharing off; the Public page is then hidden.
  publicDir: '/Public',
  publicBase: '',
}
