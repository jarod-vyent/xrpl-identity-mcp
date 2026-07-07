import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { isValidClassicAddress, type SignerListSet } from 'xrpl'

import { getXrplClient, type XrplClientLike } from '../xrpl-client.js'
import {
  addressSchema,
  okResult,
  prepareInstructions,
  prepareUnsignedTransaction,
  runTool,
  type JsonRecord,
} from './common.js'

const signerSchema = z.object({
  address: addressSchema.describe('Classic XRPL signer account address.'),
  weight: z.number().int().min(1).describe('Signer weight; must be at least 1.'),
})

export function registerSignerTools(server: McpServer): void {
  server.registerTool(
    'signer_list_prepare_set',
    {
      title: 'Prepare SignerListSet',
      description:
        'Prepare an unsigned SignerListSet transaction to create, replace, or delete an XRPL multisign signer list. This server never signs or stores keys.',
      inputSchema: {
        account: addressSchema.describe('Classic XRPL account whose signer list is being changed.'),
        quorum: z.number().int().min(0).describe('Required signer weight sum. Use 0 with no signers to delete the list.'),
        signers: z
          .array(signerSchema)
          .describe('Signer entries. Use an empty array only when quorum is 0 to delete the list.'),
      },
    },
    async (args) =>
      runTool(async (config) => {
        const client = await getXrplClient(config)
        return okResult(config.network, await prepareSignerListSet(client, args))
      }),
  )
}

export interface SignerListSetArgs {
  account: string
  quorum: number
  signers: Array<{ address: string; weight: number }>
}

export async function prepareSignerListSet(
  client: XrplClientLike,
  args: SignerListSetArgs,
): Promise<JsonRecord> {
  validateSignerListArgs(args)

  const transaction: SignerListSet = {
    TransactionType: 'SignerListSet',
    Account: args.account,
    SignerQuorum: args.quorum,
  }

  if (args.quorum > 0) {
    transaction.SignerEntries = args.signers.map((signer) => ({
      SignerEntry: {
        Account: signer.address,
        SignerWeight: signer.weight,
      },
    }))
  }

  const unsignedTx = await prepareUnsignedTransaction(client, transaction)
  return {
    unsignedTx,
    instructions: prepareInstructions('signer_list_prepare_set'),
  }
}

export function validateSignerListArgs(args: SignerListSetArgs): void {
  assertClassicAddress(args.account, 'account')

  if (args.quorum === 0) {
    if (args.signers.length !== 0) {
      throw new Error('quorum 0 deletes a signer list and requires an empty signers array.')
    }
    return
  }

  if (args.signers.length < 1 || args.signers.length > 32) {
    throw new Error('signers must include between 1 and 32 entries.')
  }

  const seen = new Set<string>()
  let weightSum = 0
  for (const signer of args.signers) {
    assertClassicAddress(signer.address, 'signer.address')
    if (signer.address === args.account) {
      throw new Error('The account cannot appear in its own signer list.')
    }
    if (seen.has(signer.address)) {
      throw new Error(`Duplicate signer address: ${signer.address}`)
    }
    seen.add(signer.address)
    if (!Number.isInteger(signer.weight) || signer.weight < 1) {
      throw new Error('Each signer weight must be an integer of at least 1.')
    }
    weightSum += signer.weight
  }

  if (args.quorum > weightSum) {
    throw new Error('quorum cannot be greater than the sum of signer weights.')
  }
}

function assertClassicAddress(value: string, fieldName: string): void {
  if (!isValidClassicAddress(value)) {
    throw new Error(`${fieldName} must be a valid classic XRPL address.`)
  }
}
