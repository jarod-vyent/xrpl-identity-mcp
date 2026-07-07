import { describe, expect, it } from 'vitest'

import { validateSignerListArgs } from '../../src/tools/signers.js'

const ACCOUNT = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SIGNER = 'r4bYF7SLUMD7QgSLLpgJx38WJSY12ViRjP'

describe('signer list validation', () => {
  it('allows quorum 0 with no signers for deletion', () => {
    expect(() =>
      validateSignerListArgs({ account: ACCOUNT, quorum: 0, signers: [] }),
    ).not.toThrow()
  })

  it('rejects quorum 0 with signers', () => {
    expect(() =>
      validateSignerListArgs({
        account: ACCOUNT,
        quorum: 0,
        signers: [{ address: SIGNER, weight: 1 }],
      }),
    ).toThrow('requires an empty signers array')
  })

  it('rejects more than 32 signers', () => {
    expect(() =>
      validateSignerListArgs({
        account: ACCOUNT,
        quorum: 1,
        signers: Array.from({ length: 33 }, (_, index) => ({
          address: index === 0 ? SIGNER : ACCOUNT,
          weight: 1,
        })),
      }),
    ).toThrow('between 1 and 32')
  })

  it('rejects quorum greater than signer weight sum', () => {
    expect(() =>
      validateSignerListArgs({
        account: ACCOUNT,
        quorum: 2,
        signers: [{ address: SIGNER, weight: 1 }],
      }),
    ).toThrow('quorum cannot be greater')
  })
})
