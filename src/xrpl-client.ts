import { Client } from 'xrpl'

import { getXrplConfig, type XrplConfig } from './config.js'

export interface XrplClientLike {
  request<T = unknown>(request: Record<string, unknown>): Promise<T>
  autofill<T extends Record<string, unknown>>(
    transaction: T,
    signersCount?: number,
  ): Promise<T>
  submit(
    transaction: string | Record<string, unknown>,
    opts?: { autofill?: boolean; failHard?: boolean },
  ): Promise<unknown>
  connect?(): Promise<void>
  disconnect?(): Promise<void>
  isConnected?(): boolean
  getLedgerIndex?(): Promise<number>
}

type ClientFactory = (config: XrplConfig) => XrplClientLike

const clients = new Map<string, XrplClientLike>()

let factory: ClientFactory = (config) =>
  new Client(config.endpoint) as unknown as XrplClientLike

function clientKey(config: XrplConfig): string {
  return `${config.network}:${config.endpoint}`
}

export async function getXrplClient(
  config: XrplConfig = getXrplConfig(),
): Promise<XrplClientLike> {
  const key = clientKey(config)
  let client = clients.get(key)
  if (!client) {
    client = factory(config)
    clients.set(key, client)
  }

  if (client.isConnected?.() !== true) {
    await client.connect?.()
  }

  return client
}

export function setXrplClientFactoryForTests(nextFactory: ClientFactory): void {
  factory = nextFactory
  clients.clear()
}

export function setXrplClientForTests(
  client: XrplClientLike,
  config: XrplConfig = getXrplConfig(),
): void {
  clients.set(clientKey(config), client)
}

export function resetXrplClientForTests(): void {
  factory = (config) => new Client(config.endpoint) as unknown as XrplClientLike
  clients.clear()
}

export async function disconnectXrplClients(): Promise<void> {
  await Promise.all(
    [...clients.values()].map(async (client) => {
      await client.disconnect?.()
    }),
  )
  clients.clear()
}
