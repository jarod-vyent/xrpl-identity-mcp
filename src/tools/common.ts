import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { getSafeNetworkLabel, getXrplConfig, type XrplConfig } from '../config.js'
import { type XrplClientLike } from '../xrpl-client.js'

export type JsonRecord = Record<string, unknown>

export const addressSchema = z.string().min(1)

export function okResult(
  network: string,
  result: JsonRecord = {},
): CallToolResult {
  const structuredContent = { network, ...result }
  return {
    structuredContent,
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
  }
}

export function errorResult(
  network: string,
  error: string,
  hint: string,
  extras: JsonRecord = {},
): CallToolResult {
  const structuredContent = { network, error, hint, ...extras }
  return {
    isError: true,
    structuredContent,
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
  }
}

export async function runTool(
  handler: (config: XrplConfig) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  let network = String(getSafeNetworkLabel())
  try {
    const config = getXrplConfig()
    network = config.network
    return await handler(config)
  } catch (error) {
    return errorResult(network, 'tool_failed', errorMessage(error))
  }
}

export async function prepareUnsignedTransaction<T extends JsonRecord>(
  client: XrplClientLike,
  transaction: T,
): Promise<T> {
  const currentLedgerIndex = await getCurrentLedgerIndex(client)
  return client.autofill({
    ...transaction,
    LastLedgerSequence: currentLedgerIndex + 100,
  })
}

export async function getCurrentLedgerIndex(
  client: XrplClientLike,
): Promise<number> {
  if (client.getLedgerIndex) {
    return client.getLedgerIndex()
  }

  const response = await client.request<{ result: { ledger_current_index: number } }>(
    { command: 'ledger_current' },
  )
  return response.result.ledger_current_index
}

export function prepareInstructions(toolName: string): string {
  return [
    `${toolName} prepared an unsigned XRPL transaction only.`,
    'Review the JSON, sign it externally in a wallet or signing agent, then call tx_decode_verify with the signed blob and the expected intent before tx_submit_signed.',
    'This MCP server never imports, stores, or uses signing keys.',
  ].join(' ')
}

export function isObjectNotFound(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  const data = getErrorData(error)
  return (
    message.includes('objectnotfound') ||
    message.includes('entrynotfound') ||
    message.includes('not found') ||
    data?.error === 'objectNotFound' ||
    data?.error === 'entryNotFound' ||
    data?.error === 'actNotFound'
  )
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function getErrorData(error: unknown): JsonRecord | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error)) {
    return undefined
  }

  const data = (error as { data?: unknown }).data
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return data as JsonRecord
  }
  return undefined
}
