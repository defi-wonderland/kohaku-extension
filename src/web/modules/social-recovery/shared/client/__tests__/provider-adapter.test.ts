/**
 * PT-038 done entry 1, the provider adapter: `IProvider`'s four reads of
 * sdk.md D-208 (the one normative list, brief delta 2), each routed through the
 * extension's own provider once with the arguments D-208 fixes. A read the
 * wrapper could not make reaches the SDK as a failure, never as an empty
 * answer, and a reverted call rejects with the raw revert data (D-208, D-209).
 *
 * The adapter may reach ethers through its high-level members (`getNetwork`,
 * `call`, `getLogs`, `getBlock`) or through raw JSON-RPC `send`; D-208 fixes
 * the arguments, not the ethers member, so each check accepts either route.
 */
import { ScriptedChain } from '@web/modules/social-recovery/sdk-doubles'
import type {
  Address,
  BlockTag,
  FilterSpec,
  Hex,
  IProvider
} from '@web/modules/social-recovery/sdk-interfaces'

import {
  adapterOver,
  callException,
  ethersOver,
  EthersMock,
  failEverything,
  underlyingCalls
} from './harness'

const TO = '0x1111111111111111111111111111111111111111' as Address
const FROM = '0x2222222222222222222222222222222222222222' as Address
const DATA = '0xdeadbeef00000000000000000000000000000000000000000000000000000001' as Hex
const TOPIC = `0x${'ab'.repeat(32)}` as Hex
const REVERT = '0x08c379a0000000000000000000000000000000000000000000000000000000000000002' as Hex

const hexOf = (n: number): string => `0x${n.toString(16)}`

/** A block tag as ethers or JSON-RPC would carry it: the name, the number, or its hex. */
const sameTag = (seen: unknown, tag: BlockTag): boolean =>
  seen === tag ||
  (typeof tag === 'number' && (seen === hexOf(tag) || seen === BigInt(tag))) ||
  (typeof tag === 'number' &&
    typeof seen === 'string' &&
    seen.startsWith('0x') &&
    Number(seen) === tag)

const sameNumber = (seen: unknown, n: number): boolean =>
  seen === n || seen === BigInt(n) || (typeof seen === 'string' && Number(seen) === n)

const lower = (a: unknown) => (typeof a === 'string' ? a.toLowerCase() : a)

interface World {
  chain: ScriptedChain
  ethers: EthersMock
  adapter: IProvider
}

const world = (): World => {
  const chain = new ScriptedChain()
  const ethers = ethersOver(chain)
  return { chain, ethers, adapter: adapterOver(ethers) as unknown as IProvider }
}

const onlyCall = (ethers: EthersMock): [string, unknown[]] => {
  const calls = underlyingCalls(ethers)
  expect(calls).toHaveLength(1)
  return calls[0]
}

describe('the provider adapter, IProvider over the extension provider', () => {
  describe('chainId()', () => {
    it('reads the chain id once and answers it as a number', async () => {
      const w = world()
      await expect(w.adapter.chainId()).resolves.toBe(w.chain.descriptor.chainId)
      const [member, args] = onlyCall(w.ethers)
      if (member === 'send') expect(args[0]).toBe('eth_chainId')
      else expect(member).toBe('getNetwork')
    })

    it('surfaces a provider failure as a thrown value', async () => {
      const w = world()
      failEverything(w.ethers, new Error('the node did not answer'))
      await expect(w.adapter.chainId()).rejects.toBeDefined()
    })
  })

  describe('call(to, data, from, block)', () => {
    it.each<[string, Address | undefined, BlockTag]>([
      ['a from address at latest', FROM, 'latest'],
      ['no from address at finalized', undefined, 'finalized'],
      ['a from address at a block number', FROM, 1234]
    ])('runs one eth_call with the target, the calldata, %s', async (_, from, tag) => {
      const w = world()
      w.chain.calls.set(`${TO.toLowerCase()}:${DATA.toLowerCase()}`, { result: '0xcafe' })
      await expect(w.adapter.call(TO, DATA, from, tag)).resolves.toBe('0xcafe')
      const [member, args] = onlyCall(w.ethers)
      let tx: Record<string, unknown>
      let seenTag: unknown
      if (member === 'send') {
        expect(args[0]).toBe('eth_call')
        const params = args[1] as unknown[]
        tx = params[0] as Record<string, unknown>
        seenTag = params[1]
      } else {
        expect(member).toBe('call')
        tx = args[0] as Record<string, unknown>
        seenTag = tx.blockTag
      }
      expect(lower(tx.to)).toBe(TO.toLowerCase())
      expect(lower(tx.data)).toBe(DATA.toLowerCase())
      if (from) expect(lower(tx.from)).toBe(from.toLowerCase())
      else expect(tx.from).toBeUndefined()
      expect(sameTag(seenTag, tag)).toBe(true)
    })

    it('rejects a reverted call with the raw revert data', async () => {
      const w = world()
      failEverything(w.ethers, callException(REVERT))
      const caught = await w.adapter.call(TO, DATA, FROM, 'latest').then(
        () => undefined,
        (e: unknown) => e
      )
      expect(caught).toBeDefined()
      expect((caught as { data?: unknown }).data).toBe(REVERT)
    })

    it('surfaces a transport failure as a thrown value, never an empty answer', async () => {
      const w = world()
      failEverything(w.ethers, new Error('the node did not answer'))
      await expect(w.adapter.call(TO, DATA, FROM, 'latest')).rejects.toBeDefined()
    })
  })

  describe('logs(filterSpec, range)', () => {
    const filter: FilterSpec = { addresses: [TO], topics: [TOPIC, null] }

    it('runs one eth_getLogs over the addresses, the topics and the two blocks of the range', async () => {
      const w = world()
      await w.adapter.logs(filter, { from: 900, to: 1900 })
      const [member, args] = onlyCall(w.ethers)
      let spec: Record<string, unknown>
      if (member === 'send') {
        expect(args[0]).toBe('eth_getLogs')
        spec = (args[1] as unknown[])[0] as Record<string, unknown>
      } else {
        expect(member).toBe('getLogs')
        spec = args[0] as Record<string, unknown>
      }
      const addresses = ([] as unknown[]).concat(spec.address).map(lower)
      expect(addresses).toEqual([TO.toLowerCase()])
      expect(spec.topics).toEqual([TOPIC, null])
      expect(sameNumber(spec.fromBlock, 900)).toBe(true)
      expect(sameNumber(spec.toBlock, 1900)).toBe(true)
    })

    it('answers raw logs with numeric block numbers and log indexes', async () => {
      const w = world()
      const log = {
        address: TO,
        topics: [TOPIC],
        data: '0x01',
        blockNumber: 950,
        blockHash: `0x${'cd'.repeat(32)}`,
        index: 3,
        logIndex: 3,
        transactionHash: `0x${'ef'.repeat(32)}`,
        removed: false
      }
      w.ethers.getLogs.mockResolvedValue([log])
      w.ethers.send.mockImplementation(async (method: string) => {
        if (method !== 'eth_getLogs') throw new Error(method)
        return [{ ...log, blockNumber: hexOf(950), logIndex: hexOf(3) }]
      })
      const logs = await w.adapter.logs(filter, { from: 900, to: 1900 })
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({
        topics: [TOPIC],
        data: '0x01',
        blockNumber: 950,
        blockHash: log.blockHash,
        logIndex: 3,
        transactionHash: log.transactionHash
      })
      expect(lower(logs[0].address)).toBe(TO.toLowerCase())
    })

    it('surfaces a provider failure as a thrown value, never an empty list', async () => {
      const w = world()
      failEverything(w.ethers, new Error('the node did not answer'))
      await expect(w.adapter.logs(filter, { from: 900, to: 1900 })).rejects.toBeDefined()
    })
  })

  describe('block(tag)', () => {
    it.each<BlockTag>(['latest', 'finalized', 950])(
      'reads one block for %s and answers its number, timestamp and hash',
      async (tag) => {
        const w = world()
        const expected = w.chain.blockAt(tag)
        const header = await w.adapter.block(tag)
        expect(header).toEqual({
          number: expected.number,
          timestamp: expected.timestamp,
          hash: expected.hash
        })
        const [member, args] = onlyCall(w.ethers)
        if (member === 'send') {
          expect(args[0]).toBe('eth_getBlockByNumber')
          expect(sameTag((args[1] as unknown[])[0], tag)).toBe(true)
        } else {
          expect(member).toBe('getBlock')
          expect(sameTag(args[0], tag)).toBe(true)
        }
      }
    )

    it('surfaces a provider failure as a thrown value', async () => {
      const w = world()
      failEverything(w.ethers, new Error('the node did not answer'))
      await expect(w.adapter.block('latest')).rejects.toBeDefined()
    })

    it('surfaces a block the node does not know as a thrown value, never an empty answer', async () => {
      const w = world()
      w.ethers.getBlock.mockResolvedValue(null)
      w.ethers.send.mockResolvedValue(null)
      await expect(w.adapter.block(123456789)).rejects.toBeDefined()
    })
  })
})
