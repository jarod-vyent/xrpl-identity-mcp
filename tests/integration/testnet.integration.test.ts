import { beforeAll, describe, expect, it } from 'vitest'

import { accountIdentitySummary } from '../../src/tools/account.js'
import { resolveDid } from '../../src/tools/did.js'
import { getXrplConfig } from '../../src/config.js'
import { disconnectXrplClients, getXrplClient } from '../../src/xrpl-client.js'

const runIntegration = process.env.SKIP_INTEGRATION !== '1'
const describeIntegration = runIntegration ? describe : describe.skip

describeIntegration('testnet integration', () => {
  beforeAll(() => {
    process.env.XRPL_NETWORK = 'testnet'
  })

  it('did_resolve on a known nonexistent DID returns exists false', async () => {
    const config = getXrplConfig()
    const client = await getXrplClient(config)
    const result = await resolveDid(client, 'rrrrrrrrrrrrrrrrrrrrBZbvji')

    expect(result).toMatchObject({ exists: false })
    await disconnectXrplClients()
  }, 30_000)

  it('account_identity_summary works for a funded testnet account', async () => {
    const account = process.env.XRPL_INTEGRATION_ACCOUNT
    if (!account) {
      return
    }

    const config = getXrplConfig()
    const client = await getXrplClient(config)
    const result = await accountIdentitySummary(client, account)

    expect(result.address).toBe(account)
    expect(result.account).toBeDefined()
    await disconnectXrplClients()
  }, 30_000)
})
