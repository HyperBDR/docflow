import { readdir, readFile } from 'node:fs/promises'

const flatten = (value, prefix = '') => Object.entries(value).flatMap(([key, item]) => {
  const path = prefix ? `${prefix}.${key}` : key
  return item && typeof item === 'object' && !Array.isArray(item) ? flatten(item, path) : [path]
})

const files = (await readdir(new URL('../src/locales/en/', import.meta.url))).filter(file => file.endsWith('.json'))
let failed = false
for (const file of files) {
  const en = JSON.parse(await readFile(new URL(`../src/locales/en/${file}`, import.meta.url), 'utf8'))
  const zh = JSON.parse(await readFile(new URL(`../src/locales/zh-CN/${file}`, import.meta.url), 'utf8'))
  const enKeys = new Set(flatten(en)), zhKeys = new Set(flatten(zh))
  const missingZh = [...enKeys].filter(key => !zhKeys.has(key))
  const missingEn = [...zhKeys].filter(key => !enKeys.has(key))
  if (missingZh.length || missingEn.length) {
    failed = true
    if (missingZh.length) process.stderr.write(`${file}: missing zh-CN keys: ${missingZh.join(', ')}\n`)
    if (missingEn.length) process.stderr.write(`${file}: missing en keys: ${missingEn.join(', ')}\n`)
  }
}
if (failed) process.exit(1)
process.stdout.write(`i18n catalogs aligned across ${files.length} namespaces\n`)
