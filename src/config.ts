export type XrplNetwork = 'mainnet' | 'testnet' | 'devnet'

export interface XrplConfig {
  network: XrplNetwork
  endpoint: string
  allowMainnetSubmit: boolean
  /**
   * True when the resolved endpoint targets XRPL mainnet, either because the
   * declared network is `mainnet` or because the endpoint host is a known
   * mainnet host. Drives the mainnet submit gate so a mislabeled endpoint can
   * never submit to mainnet ungated.
   */
  isMainnetTarget: boolean
}

export const DEFAULT_NETWORK: XrplNetwork = 'testnet'

export const XRPL_ENDPOINTS: Record<XrplNetwork, string> = {
  mainnet: 'wss://xrplcluster.com',
  testnet: 'wss://s.altnet.rippletest.net:51233',
  devnet: 'wss://s.devnet.rippletest.net:51233',
}

/**
 * Hosts that serve XRPL mainnet. A submit to any of these must be gated behind
 * ALLOW_MAINNET_SUBMIT regardless of the declared XRPL_NETWORK label.
 */
const KNOWN_MAINNET_HOSTS = new Set<string>([
  'xrplcluster.com',
  's1.ripple.com',
  's2.ripple.com',
  'xrpl.ws',
])

/**
 * Substrings that positively identify a non-mainnet (test/dev/altnet) host, so
 * a `*.ripple.com`-style altnet host is not misclassified as mainnet.
 */
const NON_MAINNET_HOST_MARKERS = ['altnet', 'devnet', 'testnet', 'rippletest', 'sidechain']

const MAINNET_ELIGIBLE_PROTOCOLS = new Set(['wss', 'ws', 'https', 'http'])

function parseEndpoint(
  endpoint: string,
): { host: string; protocol: string } | undefined {
  try {
    const url = new URL(endpoint)
    return {
      host: url.hostname.toLowerCase(),
      protocol: url.protocol.replace(/:$/u, '').toLowerCase(),
    }
  } catch {
    return undefined
  }
}

/**
 * Classify an endpoint as targeting XRPL mainnet based on its host. Only wss/https
 * (and their insecure ws/http variants) to a known mainnet host count. An explicit
 * altnet/devnet/testnet marker in the host always wins over the `ripple.com` heuristic.
 */
export function isMainnetEndpoint(endpoint: string): boolean {
  const parsed = parseEndpoint(endpoint)
  if (parsed === undefined) {
    return false
  }
  if (!MAINNET_ELIGIBLE_PROTOCOLS.has(parsed.protocol)) {
    return false
  }

  const host = parsed.host
  if (KNOWN_MAINNET_HOSTS.has(host)) {
    return true
  }
  if (NON_MAINNET_HOST_MARKERS.some((marker) => host.includes(marker))) {
    return false
  }
  return host === 'ripple.com' || host.endsWith('.ripple.com')
}

export function resolveNetwork(env: NodeJS.ProcessEnv = process.env): XrplNetwork {
  const value = env.XRPL_NETWORK ?? DEFAULT_NETWORK
  if (value === 'mainnet' || value === 'testnet' || value === 'devnet') {
    return value
  }

  throw new Error(
    `Invalid XRPL_NETWORK "${value}". Expected one of: mainnet, testnet, devnet.`,
  )
}

export function getXrplConfig(
  env: NodeJS.ProcessEnv = process.env,
): XrplConfig {
  const declaredNetwork = resolveNetwork(env)
  const endpoint = env.XRPL_ENDPOINT ?? XRPL_ENDPOINTS[declaredNetwork]
  const endpointIsMainnet = isMainnetEndpoint(endpoint)
  const isMainnetTarget = declaredNetwork === 'mainnet' || endpointIsMainnet

  // Promote the reported network to `mainnet` when the endpoint is a known
  // mainnet host so results never mislabel a mainnet target as testnet/devnet.
  // A custom endpoint we cannot classify keeps its declared label (no relabel),
  // and the submit gate errs toward blocking via isMainnetTarget.
  const network: XrplNetwork = endpointIsMainnet ? 'mainnet' : declaredNetwork

  return {
    network,
    endpoint,
    allowMainnetSubmit: env.ALLOW_MAINNET_SUBMIT === 'true',
    isMainnetTarget,
  }
}

export function getSafeNetworkLabel(
  env: NodeJS.ProcessEnv = process.env,
): XrplNetwork | 'invalid' {
  try {
    return resolveNetwork(env)
  } catch {
    return 'invalid'
  }
}

export interface SubmitGateResult {
  allowed: boolean
  error?: string
  hint?: string
}

export function checkMainnetSubmitGate(config: XrplConfig): SubmitGateResult {
  // Gate when EITHER the declared network is mainnet OR the effective endpoint
  // is a mainnet host (isMainnetTarget). `network === 'mainnet'` is kept as a
  // defense-in-depth check for hand-constructed configs.
  const targetsMainnet = config.isMainnetTarget || config.network === 'mainnet'
  if (!targetsMainnet || config.allowMainnetSubmit) {
    return { allowed: true }
  }

  return {
    allowed: false,
    error: 'mainnet_submit_disabled',
    hint:
      'tx_submit_signed is disabled on mainnet unless ALLOW_MAINNET_SUBMIT=true is set. Reads and unsigned transaction preparation are still allowed.',
  }
}
