// Copies pdf.js's data files (fonts, CMaps, colour profiles, WASM decoders) next to
// the app, so PDFs render without loading anything from a CDN.
import { cpSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const src = dirname(require.resolve('pdfjs-dist/package.json'))
const dest = join(import.meta.dirname, '..', 'public', 'pdfjs')
rmSync(dest, { recursive: true, force: true })
for (const dir of ['cmaps', 'standard_fonts', 'iccs', 'wasm']) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true })
}
console.log('pdf.js assets copied to public/pdfjs')
