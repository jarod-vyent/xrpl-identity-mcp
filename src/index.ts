#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { disconnectXrplClients } from './xrpl-client.js'
import { registerAccountTools } from './tools/account.js'
import { registerCredentialTools } from './tools/credentials.js'
import { registerDidTools } from './tools/did.js'
import { registerSignerTools } from './tools/signers.js'
import { registerTransactionTools } from './tools/tx.js'

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'xrpl-identity-mcp',
    version: '0.1.0',
  })

  registerDidTools(server)
  registerCredentialTools(server)
  registerAccountTools(server)
  registerSignerTools(server)
  registerTransactionTools(server)

  return server
}

export async function main(): Promise<void> {
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)

  const shutdown = async (): Promise<void> => {
    await server.close()
    await disconnectXrplClients()
  }

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0))
  })
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
}
