#!/usr/bin/env node
import { realpathSync } from 'node:fs'
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
    version: '0.1.2',
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

/**
 * True when this module is the process entry point. npm installs the bin as a
 * symlink (node_modules/.bin/xrpl-identity-mcp -> dist/index.js) while
 * import.meta.url is the symlink-resolved path, so argv[1] must be
 * realpath'd before comparing or the npx/global-install invocation
 * silently never starts the server.
 */
function isDirectInvocation(): boolean {
  const invoked = process.argv[1]
  if (invoked === undefined) {
    return false
  }
  try {
    return import.meta.url === pathToFileURL(realpathSync(invoked)).href
  } catch {
    return false
  }
}

if (isDirectInvocation()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
}
