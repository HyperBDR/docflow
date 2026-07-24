import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

test('guide tooltip allows the floating arrow outside the card boundary', () => {
  const rule = styles.match(/\.interactive-tooltip\s*\{([^}]+)\}/)?.[1] || ''
  assert.match(rule, /overflow:\s*visible/)
  assert.doesNotMatch(rule, /overflow:\s*hidden/)
})
