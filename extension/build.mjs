import esbuild from 'esbuild'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'

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
const outputDirectory = process.env.DOCFLOW_EXTENSION_OUTPUT_DIR || 'dist'
const nameSuffix = (process.env.DOCFLOW_EXTENSION_NAME_SUFFIX || '').trim()
const updateChannel = (process.env.DOCFLOW_EXTENSION_UPDATE_CHANNEL || (/^dev$/i.test(nameSuffix) ? 'dev' : /^beta$/i.test(nameSuffix) ? 'beta' : 'stable')).toLowerCase()

const watch = process.argv.includes('--watch')
await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })
await Promise.all(['manifest.json', 'popup.html', 'popup.css'].map(file => cp(`src/${file}`, `${outputDirectory}/${file}`)))
await cp('src/icons', `${outputDirectory}/icons`, { recursive: true })
await cp('src/_locales', `${outputDirectory}/_locales`, { recursive: true })
if (nameSuffix) {
  const manifestPath = `${outputDirectory}/manifest.json`
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.version_name = `${manifest.version}-${nameSuffix.toLowerCase()}`
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  for (const locale of await readdir(`${outputDirectory}/_locales`)) {
    const messagesPath = `${outputDirectory}/_locales/${locale}/messages.json`
    const messages = JSON.parse(await readFile(messagesPath, 'utf8'))
    messages.extensionName.message = `${messages.extensionName.message} ${nameSuffix}`
    await writeFile(messagesPath, `${JSON.stringify(messages, null, 2)}\n`)
  }
  const popupPath = `${outputDirectory}/popup.html`
  const popup = await readFile(popupPath, 'utf8')
  await writeFile(popupPath, popup.replace('<small>RECORDER</small>', `<small>RECORDER ${nameSuffix.toUpperCase()}</small>`))
}
const options = {
  entryPoints: ['src/background.ts', 'src/content.ts', 'src/popup.ts'], bundle: true, outdir: outputDirectory, format: 'iife', target: 'chrome114',
  define: {
    __DOCFLOW_API_URL__: JSON.stringify(apiUrl.replace(/\/$/, '')),
    __DOCFLOW_WEB_URL__: JSON.stringify(webUrl.replace(/\/$/, '')),
    __DOCFLOW_UPDATE_CHANNEL__: JSON.stringify(updateChannel),
  },
}
if (watch) {
  const context = await esbuild.context(options)
  await context.watch()
  console.log('Watching extension sources…')
} else await esbuild.build(options)
