import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_DOCUMENT_BYTES = 1_000_000
const FETCH_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3

const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://w3s.link/ipfs/',
]

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export interface FetchedDocument {
  source: string
  document?: unknown
  documentSkipped?: string
  contentType?: string
  byteLength: number
}

/**
 * Raised when a fetch target is rejected by the SSRF guard. Messages are
 * category-level only (never the resolved internal IP) so no internal detail
 * leaks back to the agent.
 */
export class BlockedTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedTargetError'
  }
}

export async function fetchDidDocument(uri: string): Promise<FetchedDocument> {
  const urls = urlsForUri(uri)
  if (urls.length === 0) {
    throw new Error('Only ipfs:// and https:// DID document URIs can be fetched.')
  }

  const errors: string[] = []
  for (const url of urls) {
    try {
      return await fetchWithLimits(url)
    } catch (error) {
      errors.push(`${url}: ${errorMessage(error)}`)
    }
  }

  throw new Error(`Unable to fetch DID document. ${errors.join('; ')}`)
}

function urlsForUri(uri: string): string[] {
  if (uri.startsWith('https://')) {
    return [uri]
  }

  if (!uri.startsWith('ipfs://')) {
    return []
  }

  const path = uri.slice('ipfs://'.length).replace(/^\/+/u, '')
  return IPFS_GATEWAYS.map((gateway) => `${gateway}${path}`)
}

async function fetchWithLimits(initialUrl: string): Promise<FetchedDocument> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    let currentUrl = initialUrl

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      // Re-validate every hop (initial request + each redirect target) so a
      // public URL cannot 30x-redirect into a private/metadata address.
      const url = await assertTargetAllowed(currentUrl)
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
      })

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location')
        if (!location) {
          throw new Error(`HTTP ${response.status} redirect without Location header.`)
        }
        currentUrl = new URL(location, url).toString()
        continue
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const contentLength = response.headers.get('content-length')
      if (contentLength && Number(contentLength) > MAX_DOCUMENT_BYTES) {
        throw new Error('Document exceeds 1MB limit.')
      }

      const bytes = await readLimited(response)
      const buffer = Buffer.concat(bytes)
      const result: FetchedDocument = {
        source: url.toString(),
        contentType: response.headers.get('content-type') ?? undefined,
        byteLength: buffer.byteLength,
      }

      if (!isInlineableContentType(result.contentType)) {
        result.documentSkipped =
          'Content type is not text or JSON; document body omitted.'
        return result
      }

      const text = decodeUtf8Strict(buffer)
      if (text === undefined) {
        result.documentSkipped =
          'Content is not valid UTF-8 text; document body omitted.'
        return result
      }

      result.document = parseJsonOrText(text)
      return result
    }

    throw new BlockedTargetError('Too many redirects while fetching the document.')
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Validate a fetch target before connecting: https-only, standard port, and
 * every DNS-resolved address must be a public address. Returns the parsed URL.
 */
export async function assertTargetAllowed(rawUrl: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new BlockedTargetError('The document URL is invalid.')
  }

  if (url.protocol !== 'https:') {
    throw new BlockedTargetError('Only https document URLs are allowed.')
  }

  if (url.port !== '' && url.port !== '443') {
    throw new BlockedTargetError('Only the standard https port 443 is allowed.')
  }

  const addresses = await resolveHostAddresses(url.hostname)
  if (addresses.length === 0) {
    throw new BlockedTargetError('The document host could not be resolved.')
  }
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new BlockedTargetError(
        'The document host resolves to a disallowed network range.',
      )
    }
  }

  return url
}

/**
 * Resolve a host to every A/AAAA address. IP literals are returned as-is.
 * Resolving all addresses (dns.lookup all) lets us reject a host that resolves
 * to any private/metadata range, mitigating DNS-rebinding to internal targets.
 */
async function resolveHostAddresses(host: string): Promise<string[]> {
  const bare = host.replace(/^\[/u, '').replace(/\]$/u, '')
  if (isIP(bare) !== 0) {
    return [bare]
  }

  const results = await lookup(host, { all: true })
  return results.map((entry) => entry.address)
}

/**
 * True when an IP address is loopback, private, link-local, unique-local,
 * unspecified, or otherwise not a safe public destination. Pure and testable.
 */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) {
    return isBlockedIpv4(ip)
  }
  if (family === 6) {
    return isBlockedIpv6(ip)
  }
  // Not a parseable IP: fail closed.
  return true
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number(part))
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true
  }

  const [a, b] = parts
  if (a === 0) return true // 0.0.0.0/8 (incl 0.0.0.0)
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 10) return true // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local (incl 169.254.169.254 metadata)
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a >= 224) return true // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0] // strip zone id
  if (addr === '::1') return true // loopback
  if (addr === '::') return true // unspecified

  const mapped = extractMappedIpv4(addr)
  if (mapped !== undefined) {
    return isBlockedIpv4(mapped)
  }

  const first = firstHextet(addr)
  if (first >= 0xfc00 && first <= 0xfdff) return true // fc00::/7 unique-local
  if (first >= 0xfe80 && first <= 0xfebf) return true // fe80::/10 link-local
  return false
}

function extractMappedIpv4(addr: string): string | undefined {
  const dotted = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/u)
  if (dotted && (addr.startsWith('::ffff:') || addr.startsWith('::'))) {
    return dotted[1]
  }

  const hex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u)
  if (hex) {
    const hi = parseInt(hex[1], 16)
    const lo = parseInt(hex[2], 16)
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
  }

  return undefined
}

function firstHextet(addr: string): number {
  const head = addr.split('::')[0]?.split(':')[0] ?? ''
  if (head === '') {
    return 0
  }
  const value = parseInt(head, 16)
  return Number.isNaN(value) ? 0 : value
}

async function readLimited(response: Response): Promise<Buffer[]> {
  if (!response.body) {
    return []
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    if (!value) {
      continue
    }

    total += value.byteLength
    if (total > MAX_DOCUMENT_BYTES) {
      await reader.cancel()
      throw new Error('Document exceeds 1MB limit.')
    }
    chunks.push(Buffer.from(value))
  }

  return chunks
}

/**
 * Only text and JSON payloads may be inlined into tool results, so a DID URI
 * pointing at an image or other binary cannot flood an MCP client's context
 * with up to 1MB of mangled bytes. A missing or bare content type is allowed
 * through here and settled by the strict UTF-8 check on the actual bytes.
 */
export function isInlineableContentType(contentType?: string): boolean {
  if (contentType === undefined) {
    return true
  }
  const mime = contentType.split(';')[0].trim().toLowerCase()
  if (mime === '') {
    return true
  }
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime.endsWith('+json')
  )
}

/**
 * Decode a buffer as UTF-8, returning undefined for anything that is not
 * clean text (invalid UTF-8 sequences or embedded NUL bytes).
 */
export function decodeUtf8Strict(buffer: Buffer): string | undefined {
  if (buffer.includes(0)) {
    return undefined
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return undefined
  }
}

function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
