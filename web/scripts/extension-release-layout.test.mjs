import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

test('extension release empty state stays inside its history table', () => {
  const rule = styles.match(/\.extension-release-table\s*>\s*\.admin-table-state\s*\{([^}]+)\}/)?.[1] || ''
  assert.match(rule, /position:\s*static/)
  assert.match(rule, /inset:\s*auto/)
})
