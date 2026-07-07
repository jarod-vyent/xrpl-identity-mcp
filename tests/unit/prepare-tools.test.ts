import { describe, expect, it, vi } from 'vitest'
import { isoTimeToRippleTime } from 'xrpl'

import { utf8ToHex } from '../../src/lib/hex.js'
import { prepareCredentialAccept, prepareCredentialCreate, prepareCredentialDelete } from '../../src/tools/credentials.js'
import { prepareDidDelete, prepareDidSet } from '../../src/tools/did.js'
import { prepareSignerListSet } from '../../src/tools/signers.js'
import type { XrplClientLike } from '../../src/xrpl-client.js'

const ACCOUNT = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const SUBJECT = 'rDTXLQ7ZKZVKz33zJbHjgVShjsBnqMBhmN'
const SIGNER = 'r4bYF7SLUMD7QgSLLpgJx38WJSY12ViRjP'

function mockClient(): XrplClientLike {
  return {
    request: vi.fn(),
    submit: vi.fn(),
    getLedgerIndex: vi.fn(async () => 10_000),
    autofill: vi.fn(async (transaction: Record<string, unknown>) => ({
      ...transaction,
      Fee: '12',
      Sequence: 7,
    })),
  }
}

describe('prepare tools', () => {
  it('builds DIDSet with encoded fields and autofill bounds', async () => {
    const client = mockClient()
    const result = await prepareDidSet(client, {
      account: ACCOUNT,
      uri: 'ipfs://bafy',
      data: 'profile',
      didDocument: '{"id":"did:xrpl:test"}',
    })

    expect(result.unsignedTx).toMatchObject({
      TransactionType: 'DIDSet',
      Account: ACCOUNT,
      URI: utf8ToHex('ipfs://bafy'),
      Data: utf8ToHex('profile'),
      DIDDocument: utf8ToHex('{"id":"did:xrpl:test"}'),
      LastLedgerSequence: 10_100,
      Fee: '12',
      Sequence: 7,
    })
  })

  it('builds DIDDelete', async () => {
    const result = await prepareDidDelete(mockClient(), ACCOUNT)

    expect(result.unsignedTx).toMatchObject({
      TransactionType: 'DIDDelete',
      Account: ACCOUNT,
      LastLedgerSequence: 10_100,
    })
  })

  it('builds CredentialCreate', async () => {
    const expiration = '2030-01-01T00:00:00.000Z'
    const result = await prepareCredentialCreate(mockClient(), {
      issuerAccount: ACCOUNT,
      subject: SUBJECT,
      credentialType: 'KYC',
      expiration,
      uri: 'https://example.com/vc.json',
    })

    expect(result.unsignedTx).toMatchObject({
      TransactionType: 'CredentialCreate',
      Account: ACCOUNT,
      Subject: SUBJECT,
      CredentialType: utf8ToHex('KYC'),
      Expiration: isoTimeToRippleTime(expiration),
      URI: utf8ToHex('https://example.com/vc.json'),
      LastLedgerSequence: 10_100,
    })
  })

  it('builds CredentialAccept', async () => {
    const result = await prepareCredentialAccept(mockClient(), {
      account: SUBJECT,
      issuer: ACCOUNT,
      credentialType: 'KYC',
    })

    expect(result.unsignedTx).toMatchObject({
      TransactionType: 'CredentialAccept',
      Account: SUBJECT,
      Issuer: ACCOUNT,
      CredentialType: utf8ToHex('KYC'),
    })
  })

  it('builds CredentialDelete', async () => {
    const result = await prepareCredentialDelete(mockClient(), {
      account: ACCOUNT,
      subject: SUBJECT,
      credentialType: 'KYC',
    })

    expect(result.unsignedTx).toMatchObject({
      TransactionType: 'CredentialDelete',
      Account: ACCOUNT,
      Subject: SUBJECT,
      CredentialType: utf8ToHex('KYC'),
    })
  })

  it('builds SignerListSet', async () => {
    const result = await prepareSignerListSet(mockClient(), {
      account: ACCOUNT,
      quorum: 1,
      signers: [{ address: SIGNER, weight: 1 }],
    })

    expect(result.unsignedTx).toMatchObject({
      TransactionType: 'SignerListSet',
      Account: ACCOUNT,
      SignerQuorum: 1,
      SignerEntries: [
        {
          SignerEntry: {
            Account: SIGNER,
            SignerWeight: 1,
          },
        },
      ],
      LastLedgerSequence: 10_100,
    })
  })

  it('rejects credentialType over 64 bytes', async () => {
    await expect(
      prepareCredentialCreate(mockClient(), {
        issuerAccount: ACCOUNT,
        subject: SUBJECT,
        credentialType: 'a'.repeat(65),
      }),
    ).rejects.toThrow('credentialType must be 64 bytes or fewer')
  })
})
