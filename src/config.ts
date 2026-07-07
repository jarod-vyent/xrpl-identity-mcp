export type XrplNetwork = 'mainnet' | 'testnet' | 'devnet'

export interface XrplConfig {
  network: XrplNetwork
  endpoint: string
  allowMainnetSubmit: boolean
}

export const DEFAULT_NETWORK: XrplNetwork = 'testnet'

export const XRPL_ENDPOINTS: Record<XrplNetwork, string> = {
  mainnet: 'wss://xrplcluster.com',
  testnet: 'wss://s.altnet.rippletest.net:51233',
  devnet: 'wss://s.devnet.rippletest.net:51233',
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
  const network = resolveNetwork(env)
  return {
    network,
    endpoint: env.XRPL_ENDPOINT ?? XRPL_ENDPOINTS[network],
    allowMainnetSubmit: env.ALLOW_MAINNET_SUBMIT === 'true',
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
  if (config.network !== 'mainnet' || config.allowMainnetSubmit) {
    return { allowed: true }
  }

  return {
    allowed: false,
    error: 'mainnet_submit_disabled',
    hint:
      'tx_submit_signed is disabled on mainnet unless ALLOW_MAINNET_SUBMIT=true is set. Reads and unsigned transaction preparation are still allowed.',
  }
}
