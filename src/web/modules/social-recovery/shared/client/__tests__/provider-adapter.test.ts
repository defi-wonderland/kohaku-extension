/**
 * The provider adapter answers `IProvider`'s four reads, each routed once
 * through the extension's own provider with the arguments the SDK fixes. A read
 * the adapter could not make reaches the SDK as a failure, never as an empty
 * answer, and a reverted call rejects with the raw revert data. The balance and
 * gas reads run on the same provider beside the adapter, since the SDK's
 * provider answers four reads and no balance.
 *
 * The SDK fixes the arguments, not the ethers member, so each check accepts the
 * high-level ethers member or the raw JSON-RPC `send`.
 */
import { ScriptedChain } from '@web/modules/social-recovery/sdk-doubles'
import type {
  Address,
  BlockTag,
  FilterSpec,
  Hex,
  IProvider,
  PreparedCall
} from '@web/modules/social-recovery/sdk-interfaces'

import {
  adapterOver,
  callException,
  createChainReads,
  ethersOver,
  EthersMock,
  failEverything,
  functionMembersOf,
  gasCallOf,
  isProviderReadFailure,
  isRevertedCall,
  NODE_ANSWERS,
  nodeRevert,
  thrownBy,
  underlyingCalls
} from './harness'

const TO = '0x1111111111111111111111111111111111111111' as Address
const FROM = '0x2222222222222222222222222222222222222222' as Address
const DATA = '0xdeadbeef00000000000000000000000000000000000000000000000000000001' as Hex
const TOPIC = `0x${'ab'.repeat(32)}` as Hex
const REVERT = `0x08c379a0${'00'.repeat(31)}20` as Hex

const hexOf = (n: number): string => `0x${n.toString(16)}`

/** A block tag as ethers or JSON-RPC would carry it: the name, the number, or its hex. */
const sameTag = (seen: unknown, tag: BlockTag): boolean =>
  seen === tag ||
  (typeof tag === 'number' &&
    (seen === BigInt(tag) ||
      (typeof seen === 'string' && seen.startsWith('0x') && Number(seen) === tag)))

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
  return { chain, ethers, adapter: adapterOver(ethers) }
}

const onlyCall = (ethers: EthersMock): [string, unknown[]] => {
  const calls = underlyingCalls(ethers)
  expect(calls).toHaveLength(1)
  return calls[0]
}

describe('the provider adapter, IProvider over the extension provider', () => {
  it('answers the four reads and nothing else', () => {
    expect(functionMembersOf(world().adapter).sort()).toEqual(['block', 'call', 'chainId', 'logs'])
  })

  describe('chainId()', () => {
    it('reads the chain id once and answers it as a number', async () => {
      const w = world()
      await expect(w.adapter.chainId()).resolves.toBe(w.chain.descriptor.chainId)
      const [member, args] = onlyCall(w.ethers)
      if (member === 'send') expect(args).toEqual(['eth_chainId', []])
      else expect(member).toBe('getNetwork')
    })

    it('surfaces a provider failure as a thrown value', async () => {
      const w = world()
      failEverything(w.ethers, new Error('the node did not answer'))
      const caught = await thrownBy(w.adapter.chainId())
      expect(isProviderReadFailure(caught)).toBe(true)
      expect((caught as { read?: string }).read).toBe('chainId')
    })
  })

  describe('call(to, data, from, block)', () => {
    const CALL_CASES: [string, Address | undefined, BlockTag][] = [
      ['a from address at latest', FROM, 'latest'],
      ['no from address at finalized', undefined, 'finalized'],
      ['a from address at a block number', FROM, 1234]
    ]
    CALL_CASES.forEach(([title, from, tag]) =>
      it(`runs one eth_call with the target, the calldata, ${title}`, async () => {
        const w = world()
        w.chain.calls.set(`${TO.toLowerCase()}:${DATA.toLowerCase()}`, { result: '0xcafe' })
        await expect(w.adapter.call(TO, DATA, from, tag)).resolves.toBe('0xcafe')
        const [member, args] = onlyCall(w.ethers)
        let tx: Record<string, unknown>
        let seenTag: unknown
        if (member === 'send') {
          expect(args[0]).toBe('eth_call')
          const params = args[1] as unknown[]
          expect(params).toHaveLength(2)
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
    )

    const REVERT_CASES: [string, unknown][] = [
      ['an ethers CALL_EXCEPTION', callException(REVERT)],
      ["the node's own JSON-RPC revert", nodeRevert(REVERT)]
    ]
    REVERT_CASES.forEach(([title, thrown]) =>
      it(`rejects a reverted call with the raw revert data, from ${title}`, async () => {
        const w = world()
        failEverything(w.ethers, thrown)
        const caught = await thrownBy(w.adapter.call(TO, DATA, FROM, 'latest'))
        expect(isRevertedCall(caught)).toBe(true)
        expect((caught as { data?: unknown }).data).toBe(REVERT)
      })
    )

    it('surfaces a transport failure as a thrown value, never an empty answer nor a revert', async () => {
      const w = world()
      failEverything(w.ethers, new Error('the node did not answer'))
      const caught = await thrownBy(w.adapter.call(TO, DATA, FROM, 'latest'))
      expect(isProviderReadFailure(caught)).toBe(true)
      expect(isRevertedCall(caught)).toBe(false)
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
        blockNumber: hexOf(950),
        blockHash: `0x${'cd'.repeat(32)}`,
        logIndex: hexOf(3),
        transactionHash: `0x${'ef'.repeat(32)}`,
        removed: false
      }
      w.ethers.getLogs.mockResolvedValue([{ ...log, blockNumber: 950, index: 3 }])
      w.ethers.send.mockImplementation(async (method: string) => {
        if (method !== 'eth_getLogs') throw new Error(method)
        return [log]
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
      const caught = await thrownBy(w.adapter.logs(filter, { from: 900, to: 1900 }))
      expect(isProviderReadFailure(caught)).toBe(true)
    })
  })

  describe('block(tag)', () => {
    const BLOCK_TAGS: BlockTag[] = ['latest', 'finalized', 950]
    BLOCK_TAGS.forEach((tag) =>
      it(`reads one block for ${tag} and answers its number, timestamp and hash`, async () => {
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
      })
    )

    it('surfaces a provider failure as a thrown value', async () => {
      const w = world()
      failEverything(w.ethers, new Error('the node did not answer'))
      const caught = await thrownBy(w.adapter.block('latest'))
      expect(isProviderReadFailure(caught)).toBe(true)
    })

    it('surfaces a block the node does not know as a thrown value, never an empty answer', async () => {
      const w = world()
      w.ethers.getBlock.mockResolvedValue(null)
      w.ethers.send.mockResolvedValue(null)
      const caught = await thrownBy(w.adapter.block(123456789))
      expect(isProviderReadFailure(caught)).toBe(true)
    })
  })
})

describe('the balance and gas reads beside the adapter', () => {
  it('reads a native balance and a gas estimate on the same extension provider', async () => {
    const w = world()
    const reads = createChainReads(w.ethers)
    await expect(reads.nativeBalance(FROM)).resolves.toBe(NODE_ANSWERS.balance)
    await expect(reads.estimateGas({ from: FROM, to: TO, data: DATA })).resolves.toBe(
      NODE_ANSWERS.gas
    )
    const methods = underlyingCalls(w.ethers).map(([member, args]) =>
      member === 'send' ? args[0] : member
    )
    expect(methods).toEqual(['eth_getBalance', 'eth_estimateGas'])
  })

  it('surfaces a balance read the provider could not make as a thrown value', async () => {
    const w = world()
    failEverything(w.ethers, new Error('the node did not answer'))
    const caught = await thrownBy(createChainReads(w.ethers).nativeBalance(FROM))
    expect(isProviderReadFailure(caught)).toBe(true)
  })

  it('reads the gas price with one eth_gasPrice and answers it in wei', async () => {
    const w = world()
    await expect(createChainReads(w.ethers).gasPrice()).resolves.toBe(NODE_ANSWERS.gasPrice)
    expect(underlyingCalls(w.ethers)).toEqual([['send', ['eth_gasPrice', []]]])
  })

  it('estimates the gas of the transaction it was given, the sender included', async () => {
    const w = world()
    await createChainReads(w.ethers).estimateGas({ from: FROM, to: TO, data: DATA, value: 5n })
    const [member, args] = onlyCall(w.ethers)
    expect(member).toBe('send')
    expect(args[0]).toBe('eth_estimateGas')
    expect((args[1] as unknown[])[0]).toMatchObject({ from: FROM, to: TO, data: DATA })
    expect(sameNumber(((args[1] as unknown[])[0] as { value: unknown }).value, 5)).toBe(true)
  })

  it('rejects the estimate of a call that would revert with its raw revert data', async () => {
    const w = world()
    failEverything(w.ethers, callException(REVERT))
    const caught = await thrownBy(
      createChainReads(w.ethers).estimateGas({ from: FROM, to: TO, data: DATA })
    )
    expect(isRevertedCall(caught)).toBe(true)
    expect((caught as { data?: unknown; read?: unknown }).data).toBe(REVERT)
    expect((caught as { read?: unknown }).read).toBe('estimateGas')
  })

  it('surfaces an estimate the provider could not make as a read failure, not a revert', async () => {
    const w = world()
    failEverything(w.ethers, new Error('the node did not answer'))
    const caught = await thrownBy(
      createChainReads(w.ethers).estimateGas({ from: FROM, to: TO, data: DATA })
    )
    expect(isProviderReadFailure(caught)).toBe(true)
    expect(isRevertedCall(caught)).toBe(false)
  })
})

describe('gasCallOf, the transaction a key sends for a prepared call', () => {
  const block = { number: 1, hash: `0x${'00'.repeat(32)}` as Hex }
  const prepared = (sender: 'account' | 'anyone'): PreparedCall => ({
    kind: 'call',
    target: TO,
    value: 7n,
    data: DATA,
    sender,
    block
  })

  it('turns a call anyone may send into the call to estimate from the given key', () => {
    expect(gasCallOf(prepared('anyone'), FROM)).toEqual({
      from: FROM,
      to: TO,
      data: DATA,
      value: 7n
    })
  })

  it('refuses a call the account sends, which the account library estimates', () => {
    expect(() => gasCallOf(prepared('account'), FROM)).toThrow()
  })
})
