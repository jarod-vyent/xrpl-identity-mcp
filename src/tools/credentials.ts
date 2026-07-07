import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  isoTimeToRippleTime,
  isValidClassicAddress,
  rippleTimeToISOTime,
  type CredentialAccept,
  type CredentialCreate,
  type CredentialDelete,
} from 'xrpl'

import { ensureUtf8ByteLength, tryHexToUtf8, utf8ToHex } from '../lib/hex.js'
import { getXrplClient, type XrplClientLike } from '../xrpl-client.js'
import {
  addressSchema,
  isObjectNotFound,
  okResult,
  prepareInstructions,
  prepareUnsignedTransaction,
  runTool,
  type JsonRecord,
} from './common.js'

const CREDENTIAL_ACCEPTED_FLAG = 0x00010000
const MAX_CREDENTIALS_RETURNED = 400

const credentialTypeSchema = z
  .string()
  .min(1)
  .describe('Credential type as UTF-8 text. Encoded to XRPL hex and capped at 64 bytes.')

export function registerCredentialTools(server: McpServer): void {
  server.registerTool(
    'credential_prepare_create',
    {
      title: 'Prepare CredentialCreate',
      description:
        'Prepare an unsigned XLS-70 CredentialCreate transaction. The issuer signs externally; this server only prepares JSON and never custodies keys.',
      inputSchema: {
        issuerAccount: addressSchema.describe('Classic XRPL issuer account address.'),
        subject: addressSchema.describe('Classic XRPL subject account address.'),
        credentialType: credentialTypeSchema,
        expiration: z
          .string()
          .datetime({ offset: true })
          .optional()
          .describe('Optional ISO-8601 expiration time converted to Ripple epoch seconds.'),
        uri: z
          .string()
          .optional()
          .describe('Optional credential URI encoded as XRPL hex URI.'),
      },
    },
    async (args) =>
      runTool(async (config) => {
        const client = await getXrplClient(config)
        return okResult(config.network, await prepareCredentialCreate(client, args))
      }),
  )

  server.registerTool(
    'credential_prepare_accept',
    {
      title: 'Prepare CredentialAccept',
      description:
        'Prepare an unsigned XLS-70 CredentialAccept transaction for a subject to accept an issued credential. Signing happens outside this server.',
      inputSchema: {
        account: addressSchema.describe('Classic XRPL subject account accepting the credential.'),
        issuer: addressSchema.describe('Classic XRPL issuer account address.'),
        credentialType: credentialTypeSchema,
      },
    },
    async (args) =>
      runTool(async (config) => {
        const client = await getXrplClient(config)
        return okResult(config.network, await prepareCredentialAccept(client, args))
      }),
  )

  server.registerTool(
    'credential_prepare_delete',
    {
      title: 'Prepare CredentialDelete',
      description:
        'Prepare an unsigned XLS-70 CredentialDelete transaction. The submitter signs externally; this server never signs or stores keys.',
      inputSchema: {
        account: addressSchema.describe('Classic XRPL account submitting the delete transaction.'),
        issuer: addressSchema.optional().describe('Optional issuer account; if omitted, Account may be treated as issuer by XRPL.'),
        subject: addressSchema.optional().describe('Optional subject account; if omitted, Account may be treated as subject by XRPL.'),
        credentialType: credentialTypeSchema,
      },
    },
    async (args) =>
      runTool(async (config) => {
        const client = await getXrplClient(config)
        return okResult(config.network, await prepareCredentialDelete(client, args))
      }),
  )

  server.registerTool(
    'credential_verify',
    {
      title: 'Verify Credential',
      description:
        'Read an XLS-70 Credential ledger object and report whether it exists, has been accepted, and is expired relative to the validated ledger close time.',
      inputSchema: {
        issuer: addressSchema.describe('Classic XRPL issuer account address.'),
        subject: addressSchema.describe('Classic XRPL subject account address.'),
        credentialType: credentialTypeSchema,
      },
    },
    async (args) =>
      runTool(async (config) => {
        const client = await getXrplClient(config)
        return okResult(config.network, await verifyCredential(client, args))
      }),
  )

  server.registerTool(
    'credential_list',
    {
      title: 'List Account Credentials',
      description:
        'List up to 400 XLS-70 Credential objects visible in an account owner directory, optionally filtered by whether the account is issuer or subject.',
      inputSchema: {
        address: addressSchema.describe('Classic XRPL account address.'),
        role: z
          .enum(['issuer', 'subject'])
          .optional()
          .describe('Optional role filter comparing the account to Issuer or Subject fields.'),
      },
    },
    async (args) =>
      runTool(async (config) => {
        const client = await getXrplClient(config)
        return okResult(config.network, await listCredentials(client, args))
      }),
  )
}

export interface CredentialCreateArgs {
  issuerAccount: string
  subject: string
  credentialType: string
  expiration?: string
  uri?: string
}

export async function prepareCredentialCreate(
  client: XrplClientLike,
  args: CredentialCreateArgs,
): Promise<JsonRecord> {
  assertClassicAddress(args.issuerAccount, 'issuerAccount')
  assertClassicAddress(args.subject, 'subject')
  const credentialType = credentialTypeToHex(args.credentialType)

  const transaction: CredentialCreate = {
    TransactionType: 'CredentialCreate',
    Account: args.issuerAccount,
    Subject: args.subject,
    CredentialType: credentialType,
  }

  if (args.expiration !== undefined) {
    const expiration = isoTimeToRippleTime(args.expiration)
    if (!Number.isFinite(expiration)) {
      throw new Error('expiration must be a valid ISO-8601 date.')
    }
    transaction.Expiration = expiration
  }

  if (args.uri !== undefined) {
    transaction.URI = utf8ToHex(args.uri)
  }

  const unsignedTx = await prepareUnsignedTransaction(client, transaction)
  return {
    unsignedTx,
    instructions: prepareInstructions('credential_prepare_create'),
  }
}

export interface CredentialAcceptArgs {
  account: string
  issuer: string
  credentialType: string
}

export async function prepareCredentialAccept(
  client: XrplClientLike,
  args: CredentialAcceptArgs,
): Promise<JsonRecord> {
  assertClassicAddress(args.account, 'account')
  assertClassicAddress(args.issuer, 'issuer')
  const transaction: CredentialAccept = {
    TransactionType: 'CredentialAccept',
    Account: args.account,
    Issuer: args.issuer,
    CredentialType: credentialTypeToHex(args.credentialType),
  }

  const unsignedTx = await prepareUnsignedTransaction(client, transaction)
  return {
    unsignedTx,
    instructions: prepareInstructions('credential_prepare_accept'),
  }
}

export interface CredentialDeleteArgs {
  account: string
  issuer?: string
  subject?: string
  credentialType: string
}

export async function prepareCredentialDelete(
  client: XrplClientLike,
  args: CredentialDeleteArgs,
): Promise<JsonRecord> {
  assertClassicAddress(args.account, 'account')
  if (args.issuer !== undefined) {
    assertClassicAddress(args.issuer, 'issuer')
  }
  if (args.subject !== undefined) {
    assertClassicAddress(args.subject, 'subject')
  }
  if (args.issuer === undefined && args.subject === undefined) {
    throw new Error('At least one of issuer or subject is required.')
  }

  const transaction: CredentialDelete = {
    TransactionType: 'CredentialDelete',
    Account: args.account,
    CredentialType: credentialTypeToHex(args.credentialType),
  }
  if (args.issuer !== undefined) {
    transaction.Issuer = args.issuer
  }
  if (args.subject !== undefined) {
    transaction.Subject = args.subject
  }

  const unsignedTx = await prepareUnsignedTransaction(client, transaction)
  return {
    unsignedTx,
    instructions: prepareInstructions('credential_prepare_delete'),
  }
}

export interface CredentialVerifyArgs {
  issuer: string
  subject: string
  credentialType: string
}

export async function verifyCredential(
  client: XrplClientLike,
  args: CredentialVerifyArgs,
): Promise<JsonRecord> {
  assertClassicAddress(args.issuer, 'issuer')
  assertClassicAddress(args.subject, 'subject')
  const credentialType = credentialTypeToHex(args.credentialType)

  try {
    const response = await client.request<{ result: { node: JsonRecord } }>({
      command: 'ledger_entry',
      credential: {
        issuer: args.issuer,
        subject: args.subject,
        credentialType,
      },
      ledger_index: 'validated',
    })
    const raw = response.result.node
    const closeTime = await getValidatedLedgerCloseTime(client)
    const expiration = typeof raw.Expiration === 'number' ? raw.Expiration : undefined

    return {
      exists: true,
      accepted: credentialAccepted(raw),
      expired: expiration !== undefined ? expiration <= closeTime : false,
      expiration: expiration !== undefined ? rippleTimeToISOTime(expiration) : undefined,
      uri: tryHexToUtf8(raw.URI),
      credentialType: tryHexToUtf8(raw.CredentialType) ?? args.credentialType,
      raw,
    }
  } catch (error) {
    if (isObjectNotFound(error)) {
      return {
        exists: false,
        issuer: args.issuer,
        subject: args.subject,
        credentialType: args.credentialType,
      }
    }
    throw error
  }
}

export interface CredentialListArgs {
  address: string
  role?: 'issuer' | 'subject'
}

export async function listCredentials(
  client: XrplClientLike,
  args: CredentialListArgs,
): Promise<JsonRecord> {
  assertClassicAddress(args.address, 'address')
  const credentials: JsonRecord[] = []
  let marker: unknown

  do {
    const response = await client.request<{
      result: {
        account_objects: JsonRecord[]
        marker?: unknown
      }
    }>({
      command: 'account_objects',
      account: args.address,
      type: 'credential',
      ledger_index: 'validated',
      limit: 400,
      ...(marker === undefined ? {} : { marker }),
    })

    for (const raw of response.result.account_objects) {
      if (raw.LedgerEntryType !== 'Credential') {
        continue
      }
      if (!matchesRole(raw, args.address, args.role)) {
        continue
      }
      credentials.push(decodeCredential(raw))
      if (credentials.length >= MAX_CREDENTIALS_RETURNED) {
        break
      }
    }

    marker = response.result.marker
  } while (marker !== undefined && credentials.length < MAX_CREDENTIALS_RETURNED)

  return {
    address: args.address,
    role: args.role,
    count: credentials.length,
    truncated: marker !== undefined,
    credentials,
  }
}

function credentialTypeToHex(credentialType: string): string {
  ensureUtf8ByteLength(credentialType, 64, 'credentialType')
  return utf8ToHex(credentialType)
}

function decodeCredential(raw: JsonRecord): JsonRecord {
  return {
    ...raw,
    credentialType: tryHexToUtf8(raw.CredentialType),
    uri: tryHexToUtf8(raw.URI),
    accepted: credentialAccepted(raw),
  }
}

function matchesRole(
  raw: JsonRecord,
  address: string,
  role: 'issuer' | 'subject' | undefined,
): boolean {
  if (role === 'issuer') {
    return raw.Issuer === address
  }
  if (role === 'subject') {
    return raw.Subject === address
  }
  return true
}

function credentialAccepted(raw: JsonRecord): boolean {
  const flags = raw.Flags
  if (typeof flags === 'number') {
    return (flags & CREDENTIAL_ACCEPTED_FLAG) !== 0
  }
  if (typeof flags === 'object' && flags !== null && !Array.isArray(flags)) {
    return (flags as { lsfAccepted?: boolean }).lsfAccepted === true
  }
  return false
}

async function getValidatedLedgerCloseTime(client: XrplClientLike): Promise<number> {
  const response = await client.request<{
    result: { ledger?: { close_time?: number } }
  }>({
    command: 'ledger',
    ledger_index: 'validated',
  })

  const closeTime = response.result.ledger?.close_time
  if (typeof closeTime === 'number') {
    return closeTime
  }

  return Math.floor(Date.now() / 1000) - 946684800
}

function assertClassicAddress(value: string, fieldName: string): void {
  if (!isValidClassicAddress(value)) {
    throw new Error(`${fieldName} must be a valid classic XRPL address.`)
  }
}
