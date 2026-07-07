import { describe, expect, it } from 'vitest'

import {
  assertTargetAllowed,
  BlockedTargetError,
  isBlockedAddress,
} from '../../src/ipfs.js'

describe('isBlockedAddress (finding 2)', () => {
  const blocked = [
    '127.0.0.1', // loopback
    '127.9.9.9',
    '10.0.0.1', // private
    '10.255.255.255',
    '172.16.0.1', // private /12
    '172.31.255.255',
    '192.168.0.1', // private
    '169.254.0.1', // link-local
    '169.254.169.254', // cloud metadata
    '0.0.0.0', // unspecified
    '100.64.0.1', // CGNAT
    '224.0.0.1', // multicast
    '::1', // v6 loopback
    '::', // v6 unspecified
    'fc00::1', // unique-local
    'fd12:3456::1', // unique-local
    'fe80::1', // v6 link-local
    '::ffff:127.0.0.1', // v4-mapped loopback
    '::ffff:169.254.169.254', // v4-mapped metadata
    'not-an-ip', // fail closed
    '', // fail closed
  ]

  const allowed = [
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34', // example.com
    '172.15.0.1', // just below the /12 private block
    '172.32.0.1', // just above the /12 private block
    '192.167.255.255', // just below 192.168/16
    '169.253.255.255', // just below link-local
    '100.63.255.255', // just below CGNAT
    '2001:4860:4860::8888', // Google DNS (v6)
    '2606:4700:4700::1111', // Cloudflare DNS (v6)
  ]

  it.each(blocked)('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each(allowed)('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false)
  })
})

describe('assertTargetAllowed URL shape (finding 2)', () => {
  it('rejects non-https schemes', async () => {
    await expect(assertTargetAllowed('http://example.com/')).rejects.toBeInstanceOf(
      BlockedTargetError,
    )
    await expect(assertTargetAllowed('file:///etc/passwd')).rejects.toBeInstanceOf(
      BlockedTargetError,
    )
  })

  it('rejects non-standard ports', async () => {
    await expect(
      assertTargetAllowed('https://example.com:8443/'),
    ).rejects.toBeInstanceOf(BlockedTargetError)
  })

  it('rejects https to a loopback / metadata IP literal (no DNS needed)', async () => {
    await expect(assertTargetAllowed('https://127.0.0.1/')).rejects.toBeInstanceOf(
      BlockedTargetError,
    )
    await expect(
      assertTargetAllowed('https://169.254.169.254/latest/meta-data/'),
    ).rejects.toBeInstanceOf(BlockedTargetError)
    await expect(assertTargetAllowed('https://[::1]/')).rejects.toBeInstanceOf(
      BlockedTargetError,
    )
  })
})
