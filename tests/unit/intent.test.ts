import { describe, expect, it } from 'vitest'

import { compareIntent } from '../../src/lib/intent.js'

describe('intent comparison', () => {
  it('matches partial intents', () => {
    const comparison = compareIntent(
      { TransactionType: 'DIDSet', Account: 'rExample', Fee: '12' },
      { TransactionType: 'DIDSet' },
    )

    expect(comparison.matches).toBe(true)
    expect(comparison.mismatches).toEqual([])
  })

  it('reports mismatches with field paths', () => {
    const comparison = compareIntent(
      { TransactionType: 'DIDDelete', Account: 'rActual' },
      { Account: 'rExpected' },
    )

    expect(comparison.matches).toBe(false)
    expect(comparison.mismatches).toEqual([
      { field: 'Account', expected: 'rExpected', actual: 'rActual' },
    ])
  })

  it('normalizes hex fields before comparing', () => {
    const comparison = compareIntent(
      { CredentialType: '4B5943', URI: '697066733A2F2F62616679' },
      { CredentialType: '4b5943', URI: '697066733a2f2f62616679' },
    )

    expect(comparison.matches).toBe(true)
  })

  it('normalizes Amount values', () => {
    const comparison = compareIntent(
      { Amount: '0001000', DeliverMin: { currency: 'USD', issuer: 'rIssuer', value: '1.2300' } },
      { Amount: '1000', DeliverMin: { issuer: 'rIssuer', currency: 'USD', value: '1.23' } },
    )

    expect(comparison.matches).toBe(true)
  })
})
