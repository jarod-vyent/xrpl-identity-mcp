import { describe, expect, it, vi } from 'vitest'

// Control listCredentials so we can assert the summary faithfully forwards the
// per-role `truncated` flag (finding 5): issuer is truncated, subject is not.
vi.mock('../../src/tools/credentials.js', () => ({
  listCredentials: vi.fn(
    async (_client: unknown, args: { role?: 'issuer' | 'subject' }) => {
      if (args.role === 'issuer') {
        return { address: 'x', role: 'issuer', count: 400, truncated: true, credentials: [] }
      }
      return { address: 'x', role: 'subject', count: 5, truncated: false, credentials: [] }
    },
  ),
}))

import { accountIdentitySummary } from '../../src/tools/account.js'
import type { XrplClientLike } from '../../src/xrpl-client.js'

const ACCOUNT = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'

function mockClient(): XrplClientLike {
  const request = vi.fn(async (req: Record<string, unknown>) => {
    if (req.command === 'account_info') {
      return {
        result: {
          account_data: { Flags: 0 },
          account_flags: { disableMasterKey: false },
          ledger_index: 100,
          validated: true,
        },
      }
    }
    if (req.command === 'account_objects' && req.type === 'signer_list') {
      return { result: { account_objects: [] } }
    }
    if (req.command === 'ledger_entry') {
      throw new Error('entryNotFound')
    }
    throw new Error(`unexpected request: ${JSON.stringify(req)}`)
  })

  return { request } as unknown as XrplClientLike
}

describe('accountIdentitySummary truncation (finding 5)', () => {
  it('surfaces per-role truncation flags in credentialCounts', async () => {
    const summary = await accountIdentitySummary(mockClient(), ACCOUNT)

    expect(summary.credentialCounts).toEqual({
      issuer: 400,
      issuerTruncated: true,
      subject: 5,
      subjectTruncated: false,
    })
  })
})
