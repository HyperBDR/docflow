import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isInlineableSnapshotAsset, isSerializedStylesheetLink, replaceSerializedStyleText, serializedStyleText,
  snapshotAssetMime, sniffSnapshotFontMime, svgDataUrlWithFragment, uniqueCssAssetUrls,
} from '../src/snapshot-assets.ts'

test('allows replay-safe images and common web-font formats', () => {
  assert.equal(isInlineableSnapshotAsset('image/png'), true)
  assert.equal(isInlineableSnapshotAsset('font/woff2'), true)
  assert.equal(isInlineableSnapshotAsset('application/font-woff'), true)
  assert.equal(isInlineableSnapshotAsset('font/ttf'), true)
  assert.equal(isInlineableSnapshotAsset('font/otf'), true)
  assert.equal(isInlineableSnapshotAsset('application/octet-stream'), false)
})

test('infers a constrained asset type when a CDN returns generic binary data', () => {
  assert.equal(snapshotAssetMime('application/octet-stream', 'https://cdn.test/fontawesome-webfont.woff2?v=4.7'), 'font/woff2')
  assert.equal(snapshotAssetMime('', 'https://cdn.test/login-background.webp'), 'image/webp')
  assert.equal(snapshotAssetMime('application/octet-stream', 'https://cdn.test/application.bin'), null)
})

test('sniffs web-font containers when URLs and response headers are opaque', () => {
  const bytes = value => new Uint8Array([...value].map(character => character.charCodeAt(0)))
  assert.equal(sniffSnapshotFontMime(bytes('wOFFpayload')), 'font/woff')
  assert.equal(sniffSnapshotFontMime(bytes('wOF2payload')), 'font/woff2')
  assert.equal(sniffSnapshotFontMime(bytes('OTTOpayload')), 'font/otf')
  assert.equal(sniffSnapshotFontMime(new Uint8Array([0x00, 0x01, 0x00, 0x00, 1, 2, 3])), 'font/ttf')
  assert.equal(sniffSnapshotFontMime(bytes('ttcfpayload')), 'font/ttf')
  assert.equal(sniffSnapshotFontMime(bytes('<html>not a font</html>')), null)
})

test('reads and rewrites rrweb style element _cssText', () => {
  const node = { type: 2, tagName: 'style', attributes: { _cssText: '.login{background:url(bg.jpg)}' }, childNodes: [] }
  assert.equal(serializedStyleText(node), '.login{background:url(bg.jpg)}')
  replaceSerializedStyleText(node, '.login{background:url(data:image/jpeg;base64,AA==)}')
  assert.match(node.attributes._cssText, /data:image\/jpeg/)
})

test('recognizes rrweb linked stylesheets after rel and href are removed', () => {
  assert.equal(isSerializedStylesheetLink({ type: 2, tagName: 'link', attributes: { _cssText: '.login{background:url(bg.jpg)}' } }), true)
  assert.equal(isSerializedStylesheetLink({ type: 2, tagName: 'link', attributes: { rel: 'stylesheet', href: '/app.css' } }), true)
  assert.equal(isSerializedStylesheetLink({ type: 2, tagName: 'link', attributes: { rel: 'icon', href: '/favicon.ico' } }), false)
})

test('deduplicates CSS assets before limiting so late class backgrounds survive', () => {
  const repeated = Array.from({ length: 80 }, () => '@font-face{src:url("/fonts/icons.woff2")}').join('')
  const css = `${repeated}.login-container{background:url("/static/configImg/bg.png")}`
  assert.deepEqual(uniqueCssAssetUrls(css), ['/fonts/icons.woff2', '/static/configImg/bg.png'])
})

test('keeps an external SVG use fragment on the embedded sprite', () => {
  const data = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
  assert.equal(svgDataUrlWithFragment(data, 'https://assets.test/icons.svg#search'), `${data}#search`)
  assert.equal(svgDataUrlWithFragment('data:image/png;base64,AA==', 'https://assets.test/icons.svg#search'), 'data:image/png;base64,AA==')
})
