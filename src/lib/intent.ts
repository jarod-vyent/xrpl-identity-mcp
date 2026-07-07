import { isHex, normalizeHex } from './hex.js'

export interface IntentMismatch {
  field: string
  expected: unknown
  actual: unknown
}

export interface IntentComparison {
  matches: boolean
  mismatches: IntentMismatch[]
}

const HEX_FIELDS = new Set([
  'CredentialType',
  'Data',
  'DIDDocument',
  'Domain',
  'URI',
])

const AMOUNT_FIELDS = new Set([
  'Amount',
  'DeliverMax',
  'DeliverMin',
  'LimitAmount',
  'SendMax',
  'TakerGets',
  'TakerPays',
])

export function compareIntent(
  decoded: unknown,
  expectedIntent: unknown,
): IntentComparison {
  const mismatches: IntentMismatch[] = []
  compareValue(decoded, expectedIntent, '', mismatches)
  return { matches: mismatches.length === 0, mismatches }
}

function compareValue(
  actual: unknown,
  expected: unknown,
  path: string,
  mismatches: IntentMismatch[],
): void {
  if (expected === undefined) {
    return
  }

  const key = path.split('.').at(-1) ?? path

  if (HEX_FIELDS.has(key)) {
    if (!hexEqual(actual, expected)) {
      mismatches.push({ field: path, expected, actual })
    }
    return
  }

  if (AMOUNT_FIELDS.has(key)) {
    if (!amountEqual(actual, expected)) {
      mismatches.push({ field: path, expected, actual })
    }
    return
  }

  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) {
      mismatches.push({ field: path, expected, actual })
      return
    }

    for (const [childKey, childExpected] of Object.entries(expected)) {
      compareValue(
        actual[childKey],
        childExpected,
        path ? `${path}.${childKey}` : childKey,
        mismatches,
      )
    }
    return
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      mismatches.push({ field: path, expected, actual })
      return
    }

    expected.forEach((childExpected, index) => {
      compareValue(actual[index], childExpected, `${path}.${index}`, mismatches)
    })
    return
  }

  if (!Object.is(actual, expected)) {
    mismatches.push({ field: path, expected, actual })
  }
}

function hexEqual(actual: unknown, expected: unknown): boolean {
  if (typeof actual !== 'string' || typeof expected !== 'string') {
    return Object.is(actual, expected)
  }
  if (!isHex(actual) || !isHex(expected)) {
    return actual === expected
  }
  return normalizeHex(actual) === normalizeHex(expected)
}

function amountEqual(actual: unknown, expected: unknown): boolean {
  return stableAmount(actual) === stableAmount(expected)
}

function stableAmount(value: unknown): string {
  if (typeof value === 'string') {
    if (/^\d+$/u.test(value)) {
      return BigInt(value).toString()
    }
    return trimDecimal(value)
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return trimDecimal(value.toString())
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value.map(stableAmount))
  }

  if (isPlainObject(value)) {
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [
            key,
            key === 'value' ? stableAmount(child) : child,
          ]),
      ),
    )
  }

  return JSON.stringify(value)
}

function trimDecimal(value: string): string {
  if (!/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return value
  }

  const [whole, fractional = ''] = value.split('.')
  const trimmed = fractional.replace(/0+$/u, '')
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}
