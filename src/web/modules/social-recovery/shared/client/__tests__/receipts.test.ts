/**
 * The receipt wait follows a transaction the wallet broadcast over the
 * extension's own provider. It answers ethers' receipt, and lets ethers'
 * `CALL_EXCEPTION` for a revert and `TRANSACTION_REPLACED` for a replacement
 * through as ethers threw them, since the writes read them as they are.
 *
 * The provider is the extension's own, over the scripted node of harness.ts,
 * so ethers' own wait decides every answer. The tests watch the value ethers'
 * wait settled with, to check that the receipt wait hands on that very value.
 */
import { isError } from 'ethers'

import type { Address, Hex } from '@web/modules/social-recovery/sdk-interfaces'

import {
  createReceiptWait,
  NodeReceipt,
  NodeScript,
  NodeTransaction,
  ScriptedNode,
  scriptedNode,
  thrownBy,
  watchEthersWaits
} from './harness'

const SENDER = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A' as Address
const TARGET = '0x0000000000000000000000000000000000c70101' as Address
const OTHER_TARGET = '0x0000000000000000000000000000000000c70106' as Address
const DATA: Hex = '0x1a2b3c4d'

const HASH: Hex = `0x${'ab'.repeat(32)}`
const REPLACEMENT_HASH: Hex = `0x${'cd'.repeat(32)}`

/** The block the wait starts at; the transaction and any replacement are mined in it. */
const START = 100

const sent = (overrides: Partial<NodeTransaction> = {}): NodeTransaction => ({
  hash: HASH,
  from: SENDER,
  to: TARGET,
  nonce: 5,
  data: DATA,
  value: 0n,
  ...overrides
})

const receiptFor = (tx: NodeTransaction, status: 0 | 1): NodeReceipt => ({
  hash: tx.hash,
  from: tx.from,
  to: tx.to,
  blockNumber: tx.blockNumber ?? START,
  status,
  gasUsed: 51_234n,
  gasPrice: 2_000_000_000n
})

let nodes: ScriptedNode[] = []

const nodeWith = (script: Partial<NodeScript>): ScriptedNode => {
  const node = scriptedNode(script)
  nodes.push(node)
  return node
}

/** The node where the transaction was mined in START with the given status. */
const minedWith = (status: 0 | 1) => {
  const tx = sent({ blockNumber: START })
  return nodeWith({
    blockNumber: START + 1,
    transactions: [tx],
    receipts: [receiptFor(tx, status)],
    nonces: { [SENDER.toLowerCase()]: 6 }
  })
}

/**
 * The node where another transaction of the same sender and nonce was mined in
 * START in place of the pending one.
 */
const replacedBy = (replacement: Partial<NodeTransaction>) => {
  const tx = sent({ hash: REPLACEMENT_HASH, blockNumber: START, ...replacement })
  return nodeWith({
    blockNumber: START,
    transactions: [sent(), tx],
    receipts: [receiptFor(tx, 1)],
    nonces: { [SENDER.toLowerCase()]: 6 }
  })
}

const outcomeOf = (run: Promise<unknown>): Promise<unknown> =>
  run.then(
    (value) => value,
    (error: unknown) => error
  )

afterEach(() => {
  jest.restoreAllMocks()
  nodes.forEach((node) => node.provider.destroy())
  nodes = []
})

describe('the receipt wait', () => {
  it("answers ethers' receipt of a transaction that ran, as ethers' wait answered it", async () => {
    const node = minedWith(1)
    const ethersWaits = await watchEthersWaits(node, HASH)
    const receipt = await createReceiptWait(node.provider)(HASH)
    expect(receipt).toMatchObject({
      hash: HASH,
      status: 1,
      blockNumber: START,
      gasUsed: 51_234n,
      gasPrice: 2_000_000_000n
    })
    expect(ethersWaits).toHaveLength(1)
    expect(receipt).toBe(await ethersWaits[0])
  })

  it("lets ethers' CALL_EXCEPTION for a reverted transaction through unchanged, with its receipt", async () => {
    const node = minedWith(0)
    const ethersWaits = await watchEthersWaits(node, HASH)
    const caught = await thrownBy(createReceiptWait(node.provider)(HASH))
    expect(isError(caught, 'CALL_EXCEPTION')).toBe(true)
    expect(caught).toMatchObject({ receipt: { hash: HASH, status: 0, blockNumber: START } })
    expect(ethersWaits).toHaveLength(1)
    expect(caught).toBe(await outcomeOf(ethersWaits[0]))
  })

  const REPLACEMENTS: [string, Partial<NodeTransaction>, 'cancelled' | 'replaced' | 'repriced'][] =
    [
      ['a transaction to itself that sends nothing', { to: SENDER, data: '0x' }, 'cancelled'],
      ['another call', { to: OTHER_TARGET }, 'replaced'],
      ['the same call at another fee', {}, 'repriced']
    ]
  REPLACEMENTS.forEach(([title, replacement, reason]) =>
    it(`lets ethers' TRANSACTION_REPLACED through unchanged for ${title} mined in its place`, async () => {
      const node = replacedBy(replacement)
      const ethersWaits = await watchEthersWaits(node, HASH)
      const caught = await thrownBy(createReceiptWait(node.provider)(HASH))
      expect(isError(caught, 'TRANSACTION_REPLACED')).toBe(true)
      expect(caught).toMatchObject({
        reason,
        cancelled: reason !== 'repriced',
        hash: REPLACEMENT_HASH,
        receipt: { hash: REPLACEMENT_HASH, status: 1 }
      })
      expect(ethersWaits).toHaveLength(1)
      expect(caught).toBe(await outcomeOf(ethersWaits[0]))
    })
  )

  describe('a hash the node does not answer yet', () => {
    const unknownThenMined = (status: 0 | 1) => {
      const tx = sent({ blockNumber: START })
      return nodeWith({
        blockNumber: START + 1,
        transactions: [tx],
        forgotten: [HASH],
        receipts: [receiptFor(tx, status)]
      })
    }

    it("falls back to the provider's own wait and answers the receipt it answered", async () => {
      const node = unknownThenMined(1)
      const waitForTransaction = jest.spyOn(node.provider, 'waitForTransaction')
      const receipt = await createReceiptWait(node.provider)(HASH)
      expect(waitForTransaction).toHaveBeenCalledWith(HASH)
      expect(receipt).toBe(await waitForTransaction.mock.results[0].value)
      expect(receipt).toMatchObject({ hash: HASH, status: 1 })
    })

    it('answers a reverted receipt from that wait as the receipt, with status zero', async () => {
      const node = unknownThenMined(0)
      const waitForTransaction = jest.spyOn(node.provider, 'waitForTransaction')
      const receipt = await createReceiptWait(node.provider)(HASH)
      expect(receipt).toBe(await waitForTransaction.mock.results[0].value)
      expect(receipt).toMatchObject({ hash: HASH, status: 0, blockNumber: START })
    })
  })

  it('lets a failed read of the node through as the provider threw it', async () => {
    const node = minedWith(1)
    const failure = new Error('The node is not reachable.')
    jest.spyOn(node.provider, 'getTransaction').mockRejectedValue(failure)
    await expect(createReceiptWait(node.provider)(HASH)).rejects.toBe(failure)
  })
})
