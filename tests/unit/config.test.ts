import { describe, expect, it } from 'vitest'

import {
  checkMainnetSubmitGate,
  getXrplConfig,
  isMainnetEndpoint,
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
      isMainnetTarget: false,
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
      isMainnetTarget: false,
    })
  })

  it('blocks mainnet submit unless explicitly allowed', () => {
    expect(
      checkMainnetSubmitGate({
        network: 'mainnet',
        endpoint: XRPL_ENDPOINTS.mainnet,
        allowMainnetSubmit: false,
        isMainnetTarget: true,
      }).allowed,
    ).toBe(false)

    expect(
      checkMainnetSubmitGate({
        network: 'mainnet',
        endpoint: XRPL_ENDPOINTS.mainnet,
        allowMainnetSubmit: true,
        isMainnetTarget: true,
      }).allowed,
    ).toBe(true)
  })

  describe('effective-network mainnet gate (finding 1)', () => {
    it('classifies known mainnet hosts as mainnet endpoints', () => {
      expect(isMainnetEndpoint('wss://xrplcluster.com')).toBe(true)
      expect(isMainnetEndpoint('wss://s1.ripple.com:51233')).toBe(true)
      expect(isMainnetEndpoint('wss://s2.ripple.com')).toBe(true)
      expect(isMainnetEndpoint('wss://xrpl.ws')).toBe(true)
      expect(isMainnetEndpoint('https://XRPLCLUSTER.COM/path')).toBe(true)
    })

    it('does not classify test/dev endpoints as mainnet', () => {
      expect(isMainnetEndpoint(XRPL_ENDPOINTS.testnet)).toBe(false)
      expect(isMainnetEndpoint(XRPL_ENDPOINTS.devnet)).toBe(false)
      expect(isMainnetEndpoint('wss://s.altnet.rippletest.net:51233')).toBe(false)
      expect(isMainnetEndpoint('wss://s.devnet.rippletest.net:51233')).toBe(false)
      expect(isMainnetEndpoint('wss://my-testnet.ripple.com')).toBe(false)
      expect(isMainnetEndpoint('wss://example.invalid')).toBe(false)
      expect(isMainnetEndpoint('not-a-url')).toBe(false)
    })

    it('GATES a mainnet endpoint that is mislabeled as testnet', () => {
      // XRPL_ENDPOINT points at mainnet, XRPL_NETWORK unset (defaults testnet),
      // ALLOW_MAINNET_SUBMIT unset -> must NOT submit ungated, must NOT mislabel.
      const config = getXrplConfig({ XRPL_ENDPOINT: 'wss://xrplcluster.com' })
      expect(config.isMainnetTarget).toBe(true)
      expect(config.network).toBe('mainnet') // no longer mislabeled as testnet
      expect(checkMainnetSubmitGate(config).allowed).toBe(false)
    })

    it('GATES a mainnet endpoint even with an explicit testnet label (contradiction)', () => {
      const config = getXrplConfig({
        XRPL_NETWORK: 'testnet',
        XRPL_ENDPOINT: 'wss://s1.ripple.com:51233',
      })
      expect(config.isMainnetTarget).toBe(true)
      expect(checkMainnetSubmitGate(config).allowed).toBe(false)
    })

    it('ALLOWS a genuine testnet config to submit', () => {
      const config = getXrplConfig({ XRPL_NETWORK: 'testnet' })
      expect(config.isMainnetTarget).toBe(false)
      expect(config.network).toBe('testnet')
      expect(checkMainnetSubmitGate(config).allowed).toBe(true)
    })

    it('ALLOWS a mainnet endpoint only when ALLOW_MAINNET_SUBMIT=true', () => {
      const config = getXrplConfig({
        XRPL_ENDPOINT: 'wss://xrplcluster.com',
        ALLOW_MAINNET_SUBMIT: 'true',
      })
      expect(config.isMainnetTarget).toBe(true)
      expect(checkMainnetSubmitGate(config).allowed).toBe(true)
    })

    it('does not treat ALLOW_MAINNET_SUBMIT other than "true" as allowed', () => {
      const config = getXrplConfig({
        XRPL_NETWORK: 'mainnet',
        ALLOW_MAINNET_SUBMIT: 'TRUE',
      })
      expect(config.allowMainnetSubmit).toBe(false)
      expect(checkMainnetSubmitGate(config).allowed).toBe(false)
    })
  })
})
