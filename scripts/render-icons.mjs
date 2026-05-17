/**
 * Rendert die SVG-Vorlagen in `public/` zu PNGs für robuste Vorschauen in
 * WhatsApp, Signal, iOS-Home-Screen und Crawlern, die kein SVG akzeptieren.
 * Läuft als Pre-Step von `npm run build`.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const TASKS = [
  { svg: 'public/og-image.svg', png: 'public/og-image.png', width: 1200 },
  { svg: 'public/apple-touch-icon.svg', png: 'public/apple-touch-icon.png', width: 180 }
]

for (const task of TASKS) {
  const svgPath = resolve(root, task.svg)
  const pngPath = resolve(root, task.png)
  const svg = readFileSync(svgPath, 'utf-8')
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: task.width } })
    .render()
    .asPng()
  writeFileSync(pngPath, png)
  console.log(`rendered ${task.png} from ${task.svg}`)
}
