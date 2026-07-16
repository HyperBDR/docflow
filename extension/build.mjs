import esbuild from 'esbuild'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'

async function rootEnvironment() {
  try {
    const source = await readFile('../.env', 'utf8')
    return Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
      return match ? [[match[1], match[2].trim()]] : []
    }))
  } catch { return {} }
}

const environment = await rootEnvironment()
const apiUrl = process.env.DOCFLOW_EXTENSION_API_URL || environment.DOCFLOW_PUBLIC_BASE_URL || environment.VITE_API_URL || 'http://localhost:8001'
const webUrl = process.env.DOCFLOW_EXTENSION_WEB_URL || environment.DOCFLOW_WEB_ORIGIN || 'http://localhost:5173'

const watch = process.argv.includes('--watch')
await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })
await Promise.all(['manifest.json', 'popup.html', 'popup.css'].map(file => cp(`src/${file}`, `dist/${file}`)))
await cp('src/icons', 'dist/icons', { recursive: true })
await cp('src/_locales', 'dist/_locales', { recursive: true })
const options = {
  entryPoints: ['src/background.ts', 'src/content.ts', 'src/popup.ts'], bundle: true, outdir: 'dist', format: 'iife', target: 'chrome114',
  define: {
    __DOCFLOW_API_URL__: JSON.stringify(apiUrl.replace(/\/$/, '')),
    __DOCFLOW_WEB_URL__: JSON.stringify(webUrl.replace(/\/$/, '')),
  },
}
if (watch) {
  const context = await esbuild.context(options)
  await context.watch()
  console.log('Watching extension sources…')
} else await esbuild.build(options)
