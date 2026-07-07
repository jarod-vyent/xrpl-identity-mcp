import { describe, expect, it, vi } from 'vitest'

import { utf8ToHex } from '../../src/lib/hex.js'
import { verifyCredential } from '../../src/tools/credentials.js'
import type { XrplClientLike } from '../../src/xrpl-client.js'

const ISSUER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'rDTXLQ7ZKZVKz33zJbHjgVShjsBnqMBhmN'

describe('verifyCredential wire format (finding 4)', () => {
  it('emits a snake_case credential_type ledger_entry request', async () => {
    // Return "not found" so the tool resolves to { exists: false } and issues
    // exactly one request we can assert on.
    const request = vi.fn(async () => {
      throw new Error('entryNotFound')
    })
    const client = { request } as unknown as XrplClientLike

    const result = await verifyCredential(client, {
      issuer: ISSUER,
      subject: SUBJECT,
      credentialType: 'KYC',
    })

    expect(result.exists).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith({
      command: 'ledger_entry',
      credential: {
        issuer: ISSUER,
        subject: SUBJECT,
        credential_type: utf8ToHex('KYC'),
      },
      ledger_index: 'validated',
    })

    // Guard against a regression back to camelCase.
    const sent = request.mock.calls[0][0] as {
      credential: Record<string, unknown>
    }
    expect(sent.credential).not.toHaveProperty('credentialType')
    expect(sent.credential.credential_type).toBe(utf8ToHex('KYC'))
  })
})
