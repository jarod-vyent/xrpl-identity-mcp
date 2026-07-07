import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { isValidClassicAddress, type DIDDelete, type DIDSet } from 'xrpl'

import { fetchDidDocument } from '../ipfs.js'
import { tryHexToUtf8, utf8ToHex } from '../lib/hex.js'
import { getXrplClient, type XrplClientLike } from '../xrpl-client.js'
import {
  addressSchema,
  errorResult,
  isObjectNotFound,
  okResult,
  prepareInstructions,
  prepareUnsignedTransaction,
  runTool,
  type JsonRecord,
} from './common.js'

const didSetSchema = {
  account: addressSchema.describe('Classic XRPL account address setting the DID.'),
  uri: z.string().optional().describe('Optional DID document URI. UTF-8 encoded to XRPL hex URI.'),
  data: z.string().optional().describe('Optional DID data. UTF-8 encoded to XRPL hex Data.'),
  didDocument: z
    .string()
    .optional()
    .describe('Optional DID document JSON/string payload. UTF-8 encoded to XRPL hex DIDDocument.'),
}

export function registerDidTools(server: McpServer): void {
  server.registerTool(
    'did_resolve',
    {
      title: 'Resolve XRPL DID',
      description:
        'Resolve an XLS-40 DID object for an XRPL account or did:xrpl identifier. Returns raw ledger data, UTF-8 decoded DID fields where valid, and fetched DID document content for ipfs:// or https:// URIs.',
      inputSchema: {
        address: addressSchema.describe(
          'Classic XRPL address, did:xrpl:<address>, or did:xrpl:1:<address>.',
        ),
      },
    },
    async ({ address }) =>
      runTool(async (config) => {
        const client = await getXrplClient(config)
        const result = await resolveDid(client, address)
        return okResult(config.network, result)
      }),
  )

  server.registerTool(
    'did_prepare_set',
    {
      title: 'Prepare DIDSet',
      description:
        'Prepare an unsigned XLS-40 DIDSet transaction. This server does not sign or custody keys; sign externally and verify the signed blob before submission.',
      inputSchema: didSetSchema,
    },
    async (args) =>
      runTool(async (config) => {
        const client = await getXrplClient(config)
        const result = await prepareDidSet(client, args)
        return okResult(config.network, result)
      }),
  )

  server.registerTool(
    'did_prepare_delete',
    {
      title: 'Prepare DIDDelete',
      description:
        'Prepare an unsigned XLS-40 DIDDelete transaction for an account DID. This server never signs; sign externally and verify the blob before submitting.',
      inputSchema: {
        account: addressSchema.describe('Classic XRPL account address deleting its DID.'),
      },
    },
    async ({ account }) =>
      runTool(async (config) => {
        const client = await getXrplClient(config)
        const result = await prepareDidDelete(client, account)
        return okResult(config.network, result)
      }),
  )
}

export async function resolveDid(
  client: XrplClientLike,
  addressOrDid: string,
): Promise<JsonRecord> {
  const address = extractDidAddress(addressOrDid)
  try {
    const response = await client.request<{ result: { node: JsonRecord } }>({
      command: 'ledger_entry',
      did: address,
      ledger_index: 'validated',
    })

    const raw = response.result.node
    const decoded = decodeDidObject(raw)
    const result: JsonRecord = {
      exists: true,
      address,
      did: raw,
      decoded,
    }

    const uri = decoded.URI
    if (typeof uri === 'string' && canFetchDocumentUri(uri)) {
      try {
        const fetched = await fetchDidDocument(uri)
        result.document = fetched.document
        result.documentSource = fetched.source
        if (fetched.contentType) {
          result.documentContentType = fetched.contentType
        }
      } catch (error) {
        result.documentFetchError =
          error instanceof Error ? error.message : String(error)
      }
    }

    return result
  } catch (error) {
    if (isObjectNotFound(error)) {
      return { exists: false, address }
    }
    throw error
  }
}

export interface DidSetArgs {
  account: string
  uri?: string
  data?: string
  didDocument?: string
}

export async function prepareDidSet(
  client: XrplClientLike,
  args: DidSetArgs,
): Promise<JsonRecord> {
  assertClassicAddress(args.account, 'account')
  if (
    args.uri === undefined &&
    args.data === undefined &&
    args.didDocument === undefined
  ) {
    throw new Error('At least one of uri, data, or didDocument is required.')
  }

  const transaction: DIDSet = {
    TransactionType: 'DIDSet',
    Account: args.account,
  }

  if (args.uri !== undefined) {
    transaction.URI = utf8ToHex(args.uri)
  }
  if (args.data !== undefined) {
    transaction.Data = utf8ToHex(args.data)
  }
  if (args.didDocument !== undefined) {
    transaction.DIDDocument = utf8ToHex(args.didDocument)
  }

  const unsignedTx = await prepareUnsignedTransaction(client, transaction)
  return {
    unsignedTx,
    instructions: prepareInstructions('did_prepare_set'),
  }
}

export async function prepareDidDelete(
  client: XrplClientLike,
  account: string,
): Promise<JsonRecord> {
  assertClassicAddress(account, 'account')
  const transaction: DIDDelete = {
    TransactionType: 'DIDDelete',
    Account: account,
  }

  const unsignedTx = await prepareUnsignedTransaction(client, transaction)
  return {
    unsignedTx,
    instructions: prepareInstructions('did_prepare_delete'),
  }
}

export function extractDidAddress(value: string): string {
  const address = value.startsWith('did:xrpl:')
    ? (value.split(':').at(-1) ?? '')
    : value

  assertClassicAddress(address, 'address')
  return address
}

function decodeDidObject(raw: JsonRecord): JsonRecord {
  const decoded: JsonRecord = {}
  for (const field of ['URI', 'Data', 'DIDDocument']) {
    const value = raw[field]
    const utf8 = tryHexToUtf8(value)
    if (utf8 !== undefined) {
      decoded[field] = utf8
    }
  }
  return decoded
}

function canFetchDocumentUri(uri: string): boolean {
  return uri.startsWith('ipfs://') || uri.startsWith('https://')
}

function assertClassicAddress(value: string, fieldName: string): void {
  if (!isValidClassicAddress(value)) {
    throw new Error(`${fieldName} must be a valid classic XRPL address.`)
  }
}

export function didToolError(network: string, error: string, hint: string) {
  return errorResult(network, error, hint)
}
