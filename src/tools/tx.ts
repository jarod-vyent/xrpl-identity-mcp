import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { decode, hashes } from 'xrpl'

import { checkMainnetSubmitGate } from '../config.js'
import { compareIntent } from '../lib/intent.js'
import { getXrplClient, type XrplClientLike } from '../xrpl-client.js'
import {
  errorResult,
  isObjectNotFound,
  okResult,
  runTool,
  type JsonRecord,
} from './common.js'

const signedBlobSchema = z
  .string()
  .min(1)
  .describe('Signed XRPL transaction blob as a hexadecimal string.')

export function registerTransactionTools(server: McpServer): void {
  server.registerTool(
    'tx_decode_verify',
    {
      title: 'Decode and Verify Signed Transaction',
      description:
        'Decode a signed XRPL transaction blob, compute its hash, and optionally compare it against an expected partial intent before submission. This is the WYSIWYS safety gate.',
      inputSchema: {
        signedBlob: signedBlobSchema,
        expectedIntent: z
          .record(z.unknown())
          .optional()
          .describe('Optional partial transaction JSON. Every provided field is compared against the decoded transaction.'),
      },
    },
    async (args) =>
      runTool(async (config) =>
        okResult(config.network, decodeAndVerifyTransaction(args)),
      ),
  )

  server.registerTool(
    'tx_submit_signed',
    {
      title: 'Submit Signed Transaction',
      description:
        'Submit a pre-signed XRPL transaction blob and poll for validation. On mainnet this is blocked unless ALLOW_MAINNET_SUBMIT=true is set.',
      inputSchema: {
        signedBlob: signedBlobSchema,
        failHard: z
          .boolean()
          .optional()
          .describe('Forward fail_hard behavior to rippled submit; defaults to false.'),
      },
    },
    async (args) =>
      runTool(async (config) => {
        const gate = checkMainnetSubmitGate(config)
        if (!gate.allowed) {
          return errorResult(config.network, gate.error ?? 'submit_blocked', gate.hint ?? '')
        }

        const client = await getXrplClient(config)
        return okResult(
          config.network,
          await submitSignedTransaction(client, args.signedBlob, args.failHard),
        )
      }),
  )
}

export interface DecodeVerifyArgs {
  signedBlob: string
  expectedIntent?: JsonRecord
}

export function decodeAndVerifyTransaction(args: DecodeVerifyArgs): JsonRecord {
  const decoded = decode(args.signedBlob) as JsonRecord
  const hash = hashes.hashSignedTx(args.signedBlob)
  const comparison =
    args.expectedIntent === undefined
      ? { matches: undefined, mismatches: [] }
      : compareIntent(decoded, args.expectedIntent)

  return {
    decoded,
    hash,
    matches: comparison.matches,
    mismatches: comparison.mismatches,
  }
}

export async function submitSignedTransaction(
  client: XrplClientLike,
  signedBlob: string,
  failHard = false,
): Promise<JsonRecord> {
  const submitResponse = await client.submit(signedBlob, {
    autofill: false,
    failHard,
  })
  const submitResult = resultObject(submitResponse)
  const engineResult =
    stringField(submitResult, 'engine_result') ??
    stringField(submitResult, 'engineResult') ??
    'unknown'
  const hash =
    stringField(submitResult, 'hash') ??
    nestedStringField(submitResult, ['tx_json', 'hash']) ??
    hashes.hashSignedTx(signedBlob)

  const validation = await pollForValidation(client, hash)
  return {
    engineResult,
    hash,
    validated: validation.validated,
    explanation: explainEngineResult(engineResult, validation.validated),
    submitResult,
    ...(validation.tx === undefined ? {} : { tx: validation.tx }),
  }
}

async function pollForValidation(
  client: XrplClientLike,
  hash: string,
): Promise<{ validated: boolean; tx?: unknown }> {
  const deadline = Date.now() + 20_000
  let lastTx: unknown

  while (Date.now() < deadline) {
    await delay(1_000)
    try {
      const response = await client.request<{ result: JsonRecord }>({
        command: 'tx',
        transaction: hash,
        binary: false,
      })
      lastTx = response.result
      if (response.result.validated === true) {
        return { validated: true, tx: response.result }
      }
    } catch (error) {
      if (!isObjectNotFound(error)) {
        throw error
      }
    }
  }

  return { validated: false, tx: lastTx }
}

function explainEngineResult(engineResult: string, validated: boolean): string {
  if (engineResult === 'tesSUCCESS') {
    return validated
      ? 'The transaction was accepted and validated in a ledger.'
      : 'The transaction was accepted by the server, but validation was not observed before the polling timeout.'
  }

  if (engineResult.startsWith('tec')) {
    return 'The transaction reached consensus with a claimable fee, but the requested operation failed. Inspect the validated transaction metadata for the final outcome.'
  }

  if (engineResult.startsWith('tem')) {
    return 'The transaction is malformed and should not be retried without changing it.'
  }

  if (engineResult.startsWith('tef')) {
    return 'The transaction failed before consensus, commonly due to sequence, signature, fee, or authorization constraints.'
  }

  if (engineResult.startsWith('tel')) {
    return 'The local server rejected the transaction. It may succeed on another server or after local conditions change.'
  }

  if (engineResult.startsWith('ter')) {
    return 'The transaction may be retried after ledger conditions change.'
  }

  return 'The server returned an unrecognized engine result. Inspect submitResult for details.'
}

function resultObject(value: unknown): JsonRecord {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as JsonRecord
    if (
      typeof record.result === 'object' &&
      record.result !== null &&
      !Array.isArray(record.result)
    ) {
      return record.result as JsonRecord
    }
    return record
  }
  return {}
}

function stringField(record: JsonRecord, field: string): string | undefined {
  const value = record[field]
  return typeof value === 'string' ? value : undefined
}

function nestedStringField(
  record: JsonRecord,
  path: string[],
): string | undefined {
  let value: unknown = record
  for (const segment of path) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined
    }
    value = (value as JsonRecord)[segment]
  }
  return typeof value === 'string' ? value : undefined
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}
