import { describe, expect, it } from 'vitest'

import { hexToUtf8, tryHexToUtf8, utf8ToHex } from '../../src/lib/hex.js'

describe('hex helpers', () => {
  it('round-trips UTF-8 text through uppercase hex', () => {
    const text = 'did:xrpl:example KYC'
    const hex = utf8ToHex(text)

    expect(hex).toBe('6469643A7872706C3A6578616D706C65204B5943')
    expect(hexToUtf8(hex)).toBe(text)
  })

  it('returns undefined for invalid UTF-8 hex', () => {
    expect(tryHexToUtf8('FF')).toBeUndefined()
    expect(tryHexToUtf8('not hex')).toBeUndefined()
  })
})
