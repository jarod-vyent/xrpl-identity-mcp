const HEX_PATTERN = /^[0-9a-fA-F]*$/u

export function utf8ToHex(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex').toUpperCase()
}

export function isHex(value: string): boolean {
  return value.length % 2 === 0 && HEX_PATTERN.test(value)
}

export function normalizeHex(value: string): string {
  return value.toUpperCase()
}

export function tryHexToUtf8(value: unknown): string | undefined {
  if (typeof value !== 'string' || !isHex(value)) {
    return undefined
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(value, 'hex'),
    )
  } catch {
    return undefined
  }
}

export function hexToUtf8(value: string): string {
  const decoded = tryHexToUtf8(value)
  if (decoded === undefined) {
    throw new Error('Value is not valid UTF-8 hex.')
  }
  return decoded
}

export function ensureUtf8ByteLength(
  value: string,
  maxBytes: number,
  fieldName: string,
): void {
  const byteLength = Buffer.byteLength(value, 'utf8')
  if (byteLength === 0) {
    throw new Error(`${fieldName} must not be empty.`)
  }
  if (byteLength > maxBytes) {
    throw new Error(
      `${fieldName} must be ${maxBytes} bytes or fewer when UTF-8 encoded; got ${byteLength} bytes.`,
    )
  }
}
