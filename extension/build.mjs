import esbuild from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'

const watch = process.argv.includes('--watch')
await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })
await Promise.all(['manifest.json', 'popup.html', 'popup.css'].map(file => cp(`src/${file}`, `dist/${file}`)))
const options = { entryPoints: ['src/background.ts', 'src/content.ts', 'src/popup.ts'], bundle: true, outdir: 'dist', format: 'iife', target: 'chrome114' }
if (watch) {
  const context = await esbuild.context(options)
  await context.watch()
  console.log('Watching extension sources…')
} else await esbuild.build(options)

