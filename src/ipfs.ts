const MAX_DOCUMENT_BYTES = 1_000_000
const FETCH_TIMEOUT_MS = 10_000

const IPFS_GATEWAYS = [
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
]

export interface FetchedDocument {
  source: string
  document: unknown
  contentType?: string
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

async function fetchWithLimits(url: string): Promise<FetchedDocument> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) > MAX_DOCUMENT_BYTES) {
      throw new Error('Document exceeds 1MB limit.')
    }

    const bytes = await readLimited(response)
    const text = Buffer.concat(bytes).toString('utf8')
    return {
      source: url,
      document: parseJsonOrText(text),
      contentType: response.headers.get('content-type') ?? undefined,
    }
  } finally {
    clearTimeout(timeout)
  }
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
