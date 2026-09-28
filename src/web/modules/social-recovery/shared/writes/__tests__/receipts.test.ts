/**
 * What the classification of a write's end takes for a transaction hash and
 * for a quantity of a receipt.
 *
 * - A hash is `0x` and exactly 64 hex digits, in either case. A thrown value
 *   that names one keeps the write waiting for its receipt; a thrown value
 *   that names anything else reads that nothing was sent. A receipt is read
 *   only with such a hash.
 * - A quantity (the block, the gas used, the gas price) is a bigint, a safe
 *   whole number from zero, a `0x` hex string with at least one digit, or a
 *   string of decimal digits. Anything else, a negative among them, is left
 *   out of the receipt, and a revert whose receipt lacks a factor of its gas
 *   names no gas spent.
 */
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'

import {
  failThrown,
  GWEI,
  readingOf,
  receiptOf,
  TX_HASH,
  waitTimedOut,
  WRITE_KINDS,
  writeFailureOf
} from './harness'

const UPPER_CASE_HASH = `0x${'ABCDEF09'.repeat(8)}` as Hex

const HASHES: [string, string][] = [
  ['64 lower-case hex digits', TX_HASH],
  ['64 upper-case hex digits', UPPER_CASE_HASH],
  ['64 hex digits in mixed case', `0x${'aBcD'.repeat(16)}`]
]

const NOT_HASHES: [string, string][] = [
  ['63 hex digits', TX_HASH.slice(0, -1)],
  ['65 hex digits', `${TX_HASH}0`],
  ['a space before it', ` ${TX_HASH}`],
  ['a space after it', `${TX_HASH} `],
  ['a line break after it', `${TX_HASH}\n`],
  ['a space in place of its first digit, at the length of a hash', `0x ${TX_HASH.slice(3)}`],
  ['a letter past f, at the length of a hash', `0x${'g'.repeat(64)}`]
]

/** A mined revert as a node's JSON receipt carries it, with the quantities given. */
const nodeReceipt = (quantities: Record<string, unknown> = {}) => ({
  transactionHash: TX_HASH,
  status: '0x0',
  ...quantities
})

const minedAndRevertedWith = (receipt: Record<string, unknown>): Error =>
  Object.assign(new Error('transaction execution reverted'), { code: 'CALL_EXCEPTION', receipt })

describe('a transaction hash', () => {
  describe('a thrown value that names a hash and carries no receipt keeps the write waiting', () => {
    HASHES.forEach(([name, hash]) =>
      it(name, () => {
        expect(writeFailureOf(waitTimedOut(hash as Hex)).transactionHash).toBe(hash)
        WRITE_KINDS.forEach((write) =>
          expect(failThrown(write, waitTimedOut(hash as Hex))).toEqual({
            status: 'submitting',
            write,
            transactionHash: hash
          })
        )
      })
    )
  })

  describe('a thrown value that names no hash reads that nothing was sent', () => {
    NOT_HASHES.forEach(([name, value]) =>
      it(name, () => {
        expect(writeFailureOf(waitTimedOut(value as Hex))).not.toHaveProperty('transactionHash')
        WRITE_KINDS.forEach((write) =>
          expect(readingOf(failThrown(write, waitTimedOut(value as Hex)))).toBe('notSent')
        )
      })
    )
  })

  describe("a receipt is read with a hash, in a node's shape and in ethers' shape", () => {
    HASHES.forEach(([name, hash]) =>
      it(name, () => {
        expect(receiptOf({ transactionHash: hash, status: '0x0' })).toEqual({
          transactionHash: hash,
          status: 0
        })
        expect(receiptOf({ hash, status: 1 })).toEqual({ transactionHash: hash, status: 1 })
      })
    )
  })

  describe('a receipt is not read with anything else', () => {
    NOT_HASHES.forEach(([name, value]) =>
      it(name, () => {
        expect(receiptOf({ transactionHash: value, status: '0x0' })).toBeUndefined()
        expect(receiptOf({ hash: value, status: 1 })).toBeUndefined()
      })
    )
  })
})

describe('a quantity of a receipt', () => {
  const QUANTITIES: [string, unknown, bigint][] = [
    ['0x0a', '0x0a', 10n],
    ['a hex string in upper case, 0xFF', '0xFF', 255n],
    ['a string of decimal digits, 51234', '51234', 51_234n],
    ['a whole number, 51234', 51_234, 51_234n],
    ['a bigint', 51_234n, 51_234n],
    ['zero as 0x0', '0x0', 0n]
  ]

  const NOT_QUANTITIES: [string, unknown][] = [
    ['0x alone', '0x'],
    ['a negative decimal string', '-5'],
    ['a negative hex string', '-0x5'],
    ['a negative number', -5],
    ['0X with a capital X', '0X0a'],
    ['a hex string with a letter past f', '0x0g'],
    ['a decimal string with a fraction', '1.5'],
    ['a decimal string with a space before it', ' 10'],
    ['an empty string', ''],
    ['a number with a fraction', 1.5]
  ]

  QUANTITIES.forEach(([name, value, expected]) =>
    it(`${name} is read`, () => {
      expect(receiptOf(nodeReceipt({ gasUsed: value }))?.gasUsed).toBe(expected)
      expect(receiptOf(nodeReceipt({ effectiveGasPrice: value }))?.effectiveGasPrice).toBe(expected)
    })
  )

  NOT_QUANTITIES.forEach(([name, value]) =>
    it(`${name} is left out, and the receipt is still read`, () => {
      const receipt = receiptOf(
        nodeReceipt({ blockNumber: value, gasUsed: value, gasPrice: value })
      )
      expect(receipt).toEqual({ transactionHash: TX_HASH, status: 0 })
    })
  )

  it('a block number in hex reads as a number', () => {
    expect(receiptOf(nodeReceipt({ blockNumber: '0x6acfc1' }))?.blockNumber).toBe(7_000_001)
  })

  it('a gas price stands in for a missing effective gas price', () => {
    expect(receiptOf(nodeReceipt({ gasPrice: '0x77359400' }))?.effectiveGasPrice).toBe(2n * GWEI)
  })

  describe('the gas a mined revert spent', () => {
    it('0x0a gas used at a decimal gas price of 2 gwei spent 20 gwei', () => {
      WRITE_KINDS.forEach((write) => {
        const state = failThrown(
          write,
          minedAndRevertedWith(nodeReceipt({ gasUsed: '0x0a', effectiveGasPrice: '2000000000' }))
        )
        expect(state).toMatchObject({ status: 'failedReverted', gasSpent: 20n * GWEI })
      })
    })

    it('0x alone as the gas used names no gas spent, and the write still reads reverted', () => {
      WRITE_KINDS.forEach((write) => {
        const state = failThrown(
          write,
          minedAndRevertedWith(nodeReceipt({ gasUsed: '0x', effectiveGasPrice: '2000000000' }))
        )
        expect(readingOf(state)).toBe('reverted')
        expect(state).not.toHaveProperty('gasSpent')
      })
    })

    it('a negative gas price names no gas spent, and the write still reads reverted', () => {
      WRITE_KINDS.forEach((write) => {
        const state = failThrown(
          write,
          minedAndRevertedWith(nodeReceipt({ gasUsed: '0x0a', effectiveGasPrice: '-2000000000' }))
        )
        expect(readingOf(state)).toBe('reverted')
        expect(state).not.toHaveProperty('gasSpent')
      })
    })
  })
})
