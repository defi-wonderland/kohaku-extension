/**
 * The provider adapter: the SDK's `IProvider` over the extension's own
 * provider.
 *
 * The adapter speaks to that provider through one member, `send(method,
 * params)`, the JSON-RPC request every provider `getRpcProvider` builds
 * answers: ethers' `JsonRpcProvider`, Ambire's `BrowserProvider` over the
 * Helios light client and `ColibriRpcProvider` with its prover. So a read may
 * route through a light client and its prover.
 *
 * The four reads are the SDK's list and nothing else: the chain id, one
 * `eth_call` honouring `from` and a block tag, one `eth_getLogs` over a filter
 * and two blocks, and `block(tag)`. A reverted call rejects with its raw revert
 * data (`RevertedCall`), and a read the provider could not make rejects
 * (`ProviderReadFailure`), never answering empty.
 */
import { isHexString } from 'ethers'

import type {
  Address,
  BlockHeader,
  BlockRange,
  BlockTag,
  FilterSpec,
  Hex,
  IProvider,
  RawLog
} from '@web/modules/social-recovery/sdk-interfaces'

/**
 * The one member of the extension's provider this folder calls. Every provider
 * `getRpcProvider` returns satisfies it, and a test mocks it alone.
 */
export interface ExtensionRpc {
  send(method: string, params: unknown[]): Promise<unknown>
}

/** Every read this folder makes through the extension's provider. */
export const PROVIDER_READS = [
  'chainId',
  'call',
  'logs',
  'block',
  'nativeBalance',
  'estimateGas',
  'gasPrice'
] as const
export type ProviderRead = typeof PROVIDER_READS[number]

/** A contract answered with a revert: the error carries the raw revert data, `0x` where it gave none. */
export interface RevertedCall extends Error {
  name: 'RevertedCall'
  data: Hex
  read: 'call' | 'estimateGas'
}

/** A read the provider could not make. It is a failure, never an empty answer. */
export interface ProviderReadFailure extends Error {
  name: 'ProviderReadFailure'
  read: ProviderRead
  cause: unknown
}

export const revertedCall = (read: RevertedCall['read'], data: Hex): RevertedCall => {
  const error = new Error('execution reverted') as RevertedCall
  error.name = 'RevertedCall'
  error.read = read
  error.data = data
  return error
}

export const providerReadFailure = (read: ProviderRead, cause: unknown): ProviderReadFailure => {
  const detail = cause instanceof Error ? cause.message : String(cause)
  const error = new Error(`The provider could not answer ${read}: ${detail}`) as ProviderReadFailure
  error.name = 'ProviderReadFailure'
  error.read = read
  error.cause = cause
  return error
}

export const isRevertedCall = (value: unknown): value is RevertedCall =>
  value instanceof Error && value.name === 'RevertedCall'

export const isProviderReadFailure = (value: unknown): value is ProviderReadFailure =>
  value instanceof Error && value.name === 'ProviderReadFailure'

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** A JSON-RPC quantity: `0x` and the number in hex with no leading zero. */
export const toQuantity = (value: number | bigint): Hex => `0x${BigInt(value).toString(16)}`

/** The JSON-RPC block parameter of a tag: the two named tags as they are, a number as a quantity. */
export const blockParam = (tag: BlockTag): string =>
  typeof tag === 'number' ? toQuantity(tag) : tag

const quantity = (read: ProviderRead, value: unknown): bigint => {
  if (typeof value !== 'string' || !isHexString(value)) {
    throw providerReadFailure(read, new Error(`not a quantity: ${JSON.stringify(value)}`))
  }
  return BigInt(value === '0x' ? '0x0' : value)
}

const smallQuantity = (read: ProviderRead, value: unknown): number => {
  const n = quantity(read, value)
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw providerReadFailure(read, new Error(`quantity out of range: ${n}`))
  }
  return Number(n)
}

const hexOf = (read: ProviderRead, value: unknown): Hex => {
  if (typeof value !== 'string' || !isHexString(value)) {
    throw providerReadFailure(read, new Error(`not hex: ${JSON.stringify(value)}`))
  }
  return value as Hex
}

// ---------------------------------------------------------------------------
// Revert data
// ---------------------------------------------------------------------------

const REVERT_WORD = /revert/i
const EXECUTION_REVERTED = /execution reverted/i

/**
 * Walks a thrown value for the raw revert data a node returned. ethers puts it
 * on its `CALL_EXCEPTION` (`data`) and keeps the node's own error under
 * `info.error`; a provider that bypasses ethers (Colibri) throws the node's
 * `{ code, message, data }` itself. Answers the data, `0x` for a revert that
 * carried none, or undefined where the value is not a revert at all.
 */
export const revertDataOf = (thrown: unknown): Hex | undefined => {
  const seen = new Set<unknown>()
  let revertedWithoutData = false

  const visit = (value: unknown, depth: number): Hex | undefined => {
    if (depth > 8 || value === null || value === undefined) return undefined
    if (typeof value === 'string') {
      if (!value.trim().startsWith('{')) return undefined
      try {
        return visit(JSON.parse(value), depth + 1)
      } catch {
        return undefined
      }
    }
    if (typeof value !== 'object' || seen.has(value)) return undefined
    seen.add(value)
    const record = value as Record<string, unknown>
    const message = typeof record.message === 'string' ? record.message : ''
    if (REVERT_WORD.test(message) && typeof record.data === 'string' && isHexString(record.data)) {
      return record.data as Hex
    }
    if (record.code === 3 || EXECUTION_REVERTED.test(message)) revertedWithoutData = true
    const keys = Array.from(new Set([...Object.keys(record), 'info', 'error', 'data', 'cause']))
    let found: Hex | undefined
    keys.some((key) => {
      found = visit(record[key], depth + 1)
      return found !== undefined
    })
    return found
  }

  const data = visit(thrown, 0)
  if (data) return data
  return revertedWithoutData ? '0x' : undefined
}

/** The thrown value of a call or an estimate: a revert with its data, or a read failure. */
export const callFailureOf = (read: 'call' | 'estimateGas', thrown: unknown): Error => {
  if (isRevertedCall(thrown) || isProviderReadFailure(thrown)) return thrown
  const data = revertDataOf(thrown)
  return data === undefined ? providerReadFailure(read, thrown) : revertedCall(read, data)
}

/** Sends one request; a rejection becomes a `ProviderReadFailure` naming the read. */
export const sendRead = async (
  rpc: ExtensionRpc,
  read: ProviderRead,
  method: string,
  params: unknown[]
): Promise<unknown> => {
  try {
    return await rpc.send(method, params)
  } catch (thrown) {
    throw isProviderReadFailure(thrown) ? thrown : providerReadFailure(read, thrown)
  }
}

// ---------------------------------------------------------------------------
// The four reads
// ---------------------------------------------------------------------------

const rawLogOf = (value: unknown): RawLog => {
  if (!value || typeof value !== 'object') {
    throw providerReadFailure('logs', new Error('a log is not an object'))
  }
  const log = value as Record<string, unknown>
  if (!Array.isArray(log.topics)) {
    throw providerReadFailure('logs', new Error('a log carries no topics'))
  }
  return {
    address: hexOf('logs', log.address) as Address,
    topics: log.topics.map((topic) => hexOf('logs', topic)),
    data: hexOf('logs', log.data),
    blockNumber: smallQuantity('logs', log.blockNumber),
    blockHash: hexOf('logs', log.blockHash),
    logIndex: smallQuantity('logs', log.logIndex),
    transactionHash: hexOf('logs', log.transactionHash),
    removed: log.removed === true
  }
}

/**
 * The provider adapter over the extension's provider. Each read makes exactly
 * one request:
 *
 * - `chainId()`: `eth_chainId` with no parameters, so the answer is the
 *   connection's own and not a network record's.
 * - `call(to, data, from, block)`: `eth_call` over `{ to, data }`, with `from`
 *   where one is given, at the block tag.
 * - `logs(filterSpec, range)`: `eth_getLogs` over `{ address, topics,
 *   fromBlock, toBlock }`, the filter's addresses and topics as they are.
 * - `block(tag)`: `eth_getBlockByNumber` at the tag without transactions; a
 *   block the node does not have is a failure, not an empty header.
 */
export const createProviderAdapter = (rpc: ExtensionRpc): IProvider => ({
  async chainId(): Promise<number> {
    return smallQuantity('chainId', await sendRead(rpc, 'chainId', 'eth_chainId', []))
  },

  async call(to: Address, data: Hex, from: Address | undefined, block: BlockTag): Promise<Hex> {
    const transaction = from === undefined ? { to, data } : { from, to, data }
    let answer: unknown
    try {
      answer = await rpc.send('eth_call', [transaction, blockParam(block)])
    } catch (thrown) {
      throw callFailureOf('call', thrown)
    }
    return hexOf('call', answer)
  },

  async logs(filterSpec: FilterSpec, range: BlockRange): Promise<RawLog[]> {
    const answer = await sendRead(rpc, 'logs', 'eth_getLogs', [
      {
        address: filterSpec.addresses,
        topics: filterSpec.topics,
        fromBlock: toQuantity(range.from),
        toBlock: toQuantity(range.to)
      }
    ])
    if (!Array.isArray(answer)) {
      throw providerReadFailure('logs', new Error('the node answered no log list'))
    }
    return answer.map(rawLogOf)
  },

  async block(tag: BlockTag): Promise<BlockHeader> {
    const answer = await sendRead(rpc, 'block', 'eth_getBlockByNumber', [blockParam(tag), false])
    if (!answer || typeof answer !== 'object') {
      throw providerReadFailure('block', new Error(`the node has no block at ${String(tag)}`))
    }
    const header = answer as Record<string, unknown>
    return {
      number: smallQuantity('block', header.number),
      timestamp: smallQuantity('block', header.timestamp),
      hash: hexOf('block', header.hash)
    }
  }
})
