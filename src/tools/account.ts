import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isValidClassicAddress } from 'xrpl'

import { tryHexToUtf8 } from '../lib/hex.js'
import { getXrplClient, type XrplClientLike } from '../xrpl-client.js'
import {
  addressSchema,
  isObjectNotFound,
  okResult,
  runTool,
  type JsonRecord,
} from './common.js'
import { listCredentials } from './credentials.js'

const LSF_DISABLE_MASTER = 0x00100000

export function registerAccountTools(server: McpServer): void {
  server.registerTool(
    'account_identity_summary',
    {
      title: 'Account Identity Summary',
      description:
        'Summarize an XRPL account identity posture: AccountRoot auth flags, RegularKey and Domain state, signer list, DID presence, and visible credential counts as issuer and subject (each with a *Truncated boolean flagging when the count hit the 400-object scan cap).',
      inputSchema: {
        address: addressSchema.describe('Classic XRPL account address to summarize.'),
      },
    },
    async ({ address }) =>
      runTool(async (config) => {
        const client = await getXrplClient(config)
        return okResult(config.network, await accountIdentitySummary(client, address))
      }),
  )
}

export async function accountIdentitySummary(
  client: XrplClientLike,
  address: string,
): Promise<JsonRecord> {
  assertClassicAddress(address, 'address')
  const accountInfo = await client.request<{
    result: {
      account_data: JsonRecord
      account_flags?: { disableMasterKey?: boolean }
      ledger_index?: number
      validated?: boolean
    }
  }>({
    command: 'account_info',
    account: address,
    ledger_index: 'validated',
    strict: true,
  })

  const signerList = await readSignerList(client, address)
  const did = await readDidPresence(client, address)
  const [issuerCredentials, subjectCredentials] = await Promise.all([
    listCredentials(client, { address, role: 'issuer' }),
    listCredentials(client, { address, role: 'subject' }),
  ])

  const accountData = accountInfo.result.account_data
  return {
    address,
    account: {
      flags: {
        lsfDisableMaster:
          accountInfo.result.account_flags?.disableMasterKey ??
          numericFlagSet(accountData.Flags, LSF_DISABLE_MASTER),
      },
      regularKeySet: typeof accountData.RegularKey === 'string',
      regularKey: accountData.RegularKey,
      domain: tryHexToUtf8(accountData.Domain),
      raw: accountData,
    },
    signerList,
    did,
    credentialCounts: {
      issuer: issuerCredentials.count,
      issuerTruncated: issuerCredentials.truncated === true,
      subject: subjectCredentials.count,
      subjectTruncated: subjectCredentials.truncated === true,
    },
    ledgerIndex: accountInfo.result.ledger_index,
    validated: accountInfo.result.validated,
  }
}

async function readSignerList(
  client: XrplClientLike,
  address: string,
): Promise<JsonRecord | null> {
  const response = await client.request<{
    result: { account_objects: JsonRecord[] }
  }>({
    command: 'account_objects',
    account: address,
    type: 'signer_list',
    ledger_index: 'validated',
    limit: 400,
  })

  const raw = response.result.account_objects.find(
    (object) => object.LedgerEntryType === 'SignerList',
  )
  if (!raw) {
    return null
  }

  return {
    quorum: raw.SignerQuorum,
    entries: Array.isArray(raw.SignerEntries)
      ? raw.SignerEntries.map((entry) => {
          const signerEntry =
            typeof entry === 'object' && entry !== null && 'SignerEntry' in entry
              ? (entry as { SignerEntry: JsonRecord }).SignerEntry
              : {}
          return {
            address: signerEntry.Account,
            weight: signerEntry.SignerWeight,
          }
        })
      : [],
    raw,
  }
}

async function readDidPresence(
  client: XrplClientLike,
  address: string,
): Promise<JsonRecord> {
  try {
    const response = await client.request<{ result: { node: JsonRecord } }>({
      command: 'ledger_entry',
      did: address,
      ledger_index: 'validated',
    })
    return { exists: true, raw: response.result.node }
  } catch (error) {
    if (isObjectNotFound(error)) {
      return { exists: false }
    }
    throw error
  }
}

function numericFlagSet(flags: unknown, flag: number): boolean {
  return typeof flags === 'number' && (flags & flag) !== 0
}

function assertClassicAddress(value: string, fieldName: string): void {
  if (!isValidClassicAddress(value)) {
    throw new Error(`${fieldName} must be a valid classic XRPL address.`)
  }
}
