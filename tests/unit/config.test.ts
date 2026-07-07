import { describe, expect, it } from 'vitest'

import {
  checkMainnetSubmitGate,
  getXrplConfig,
  resolveNetwork,
  XRPL_ENDPOINTS,
} from '../../src/config.js'

describe('config', () => {
  it('defaults to testnet', () => {
    expect(resolveNetwork({})).toBe('testnet')
    expect(getXrplConfig({})).toEqual({
      network: 'testnet',
      endpoint: XRPL_ENDPOINTS.testnet,
      allowMainnetSubmit: false,
    })
  })

  it('honors explicit network and endpoint override', () => {
    expect(
      getXrplConfig({
        XRPL_NETWORK: 'devnet',
        XRPL_ENDPOINT: 'wss://example.invalid',
      }),
    ).toEqual({
      network: 'devnet',
      endpoint: 'wss://example.invalid',
      allowMainnetSubmit: false,
    })
  })

  it('blocks mainnet submit unless explicitly allowed', () => {
    expect(
      checkMainnetSubmitGate({
        network: 'mainnet',
        endpoint: XRPL_ENDPOINTS.mainnet,
        allowMainnetSubmit: false,
      }).allowed,
    ).toBe(false)

    expect(
      checkMainnetSubmitGate({
        network: 'mainnet',
        endpoint: XRPL_ENDPOINTS.mainnet,
        allowMainnetSubmit: true,
      }).allowed,
    ).toBe(true)
  })
})
