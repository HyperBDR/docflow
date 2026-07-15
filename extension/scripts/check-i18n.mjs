import { readFile } from 'node:fs/promises'

const en = JSON.parse(await readFile(new URL('../src/locales/en.json', import.meta.url), 'utf8'))
const zh = JSON.parse(await readFile(new URL('../src/locales/zh-CN.json', import.meta.url), 'utf8'))
const missingZh = Object.keys(en).filter(key => !(key in zh))
const missingEn = Object.keys(zh).filter(key => !(key in en))
if (missingZh.length || missingEn.length) {
  if (missingZh.length) process.stderr.write(`Missing zh-CN keys: ${missingZh.join(', ')}\n`)
  if (missingEn.length) process.stderr.write(`Missing en keys: ${missingEn.join(', ')}\n`)
  process.exit(1)
}
process.stdout.write(`Extension i18n catalogs aligned (${Object.keys(en).length} keys)\n`)
