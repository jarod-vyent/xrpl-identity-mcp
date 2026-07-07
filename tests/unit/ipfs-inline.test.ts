import { describe, expect, it } from 'vitest'

import { decodeUtf8Strict, isInlineableContentType } from '../../src/ipfs.js'

describe('isInlineableContentType', () => {
  const inlineable = [
    'text/plain',
    'text/plain; charset=utf-8',
    'text/html',
    'application/json',
    'application/json; charset=utf-8',
    'application/did+json',
    'application/ld+json',
    'APPLICATION/JSON',
  ]

  const notInlineable = [
    'image/jpeg',
    'image/png',
    'application/octet-stream',
    'application/pdf',
    'video/mp4',
    'application/xml',
    'audio/mpeg',
  ]

  it.each(inlineable)('inlines %s', (contentType) => {
    expect(isInlineableContentType(contentType)).toBe(true)
  })

  it.each(notInlineable)('skips %s', (contentType) => {
    expect(isInlineableContentType(contentType)).toBe(false)
  })

  it('defers a missing or empty content type to the UTF-8 sniff', () => {
    expect(isInlineableContentType(undefined)).toBe(true)
    expect(isInlineableContentType('')).toBe(true)
  })
})

describe('decodeUtf8Strict', () => {
  it('decodes clean UTF-8 text', () => {
    expect(decodeUtf8Strict(Buffer.from('{"id":"did:xrpl:1:rTest"}'))).toBe(
      '{"id":"did:xrpl:1:rTest"}',
    )
    expect(decodeUtf8Strict(Buffer.from('héllo — ✓', 'utf8'))).toBe('héllo — ✓')
  })

  it('rejects invalid UTF-8 sequences (JPEG magic bytes)', () => {
    expect(decodeUtf8Strict(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBeUndefined()
  })

  it('rejects text containing NUL bytes', () => {
    expect(decodeUtf8Strict(Buffer.from('ab\u0000cd'))).toBeUndefined()
  })

  it('decodes an empty buffer to an empty string', () => {
    expect(decodeUtf8Strict(Buffer.alloc(0))).toBe('')
  })
})
