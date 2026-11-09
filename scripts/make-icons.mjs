// Renders the app icons (PNG) used by the web app manifest. Run after changing them:
//   node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const pub = join(import.meta.dirname, '..', 'public')
const cloud = 'M20 42h25a9 9 0 0 0 1-17.9A13 13 0 0 0 21.2 27 7.5 7.5 0 0 0 20 42z'

// "any" icon: rounded tile; "maskable": full-bleed with the mark inside the safe zone.
const any = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#6750a4"/><path d="${cloud}" fill="#fff"/></svg>`
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#6750a4"/><g transform="translate(32 32) scale(.72) translate(-32.5 -33)"><path d="${cloud}" fill="#fff"/></g></svg>`

const render = (svg, size, file) =>
  writeFileSync(join(pub, file), new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng())

render(any, 192, 'icon-192.png')
render(any, 512, 'icon-512.png')
render(maskable, 512, 'icon-maskable-512.png')
render(maskable, 180, 'apple-touch-icon.png')
console.log('icons written')
