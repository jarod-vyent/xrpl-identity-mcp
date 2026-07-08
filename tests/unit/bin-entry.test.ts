import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const distEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url))
const hasBuild = existsSync(distEntry)

const INITIALIZE = `${JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'bin-entry-test', version: '0.0.0' },
  },
})}\n`

/**
 * Spawn the built entry point and wait for an MCP initialize response on
 * stdout. Resolves with the raw response; rejects if the process exits or
 * stays silent, which is exactly how the pre-0.1.2 symlink bug presented.
 */
function initializeVia(entryPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entryPath], {
      env: { ...process.env, XRPL_NETWORK: 'testnet' },
    })
    let stdout = ''
    let stderr = ''
    const finish = (fn: () => void): void => {
      clearTimeout(timer)
      child.kill()
      fn()
    }
    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `No initialize response within timeout. stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
          ),
        ),
      )
    }, 10_000)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.includes('"serverInfo"')) {
        finish(() => resolve(stdout))
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('exit', (code) => {
      finish(() =>
        reject(
          new Error(
            `Process exited (code ${code}) before responding. stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
          ),
        ),
      )
    })
    child.on('error', (error) => finish(() => reject(error)))
    child.stdin.write(INITIALIZE)
  })
}

describe.skipIf(!hasBuild)('bin entry point (requires npm run build)', () => {
  it('responds to initialize when invoked directly', async () => {
    const response = await initializeVia(distEntry)
    expect(response).toContain('"xrpl-identity-mcp"')
  })

  it('responds to initialize when invoked through a symlink like node_modules/.bin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xrpl-identity-bin-'))
    const link = join(dir, 'xrpl-identity-mcp')
    symlinkSync(distEntry, link)
    const response = await initializeVia(link)
    expect(response).toContain('"serverInfo"')
  })
})
