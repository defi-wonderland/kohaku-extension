/**
 * What the classification of a write's end takes for a transaction hash and
 * for a quantity of a receipt.
 *
 * - A hash is `0x` and exactly 64 hex digits, in either case. A thrown value
 *   that names one and carries no receipt keeps the write waiting for its
 *   receipt, and a status-zero receipt that carries one reads reverted. A
 *   thrown value with anything else in its place reads that nothing was sent.
 * - A quantity of a receipt (the gas used, the gas price) is a bigint, a safe
 *   whole number from zero, a `0x` hex string with at least one digit, or a
 *   string of decimal digits. Anything else, a negative among them, is left
 *   out, and a revert whose receipt lacks a factor of its gas names no gas
 *   spent.
 */
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'

import {
  failThrown,
  GWEI,
  minedAndReverted,
  readingOf,
  TX_HASH,
  waitTimedOut,
  WRITE_KINDS
} from './harness'

const HASHES: [string, string][] = [
  ['64 lower-case hex digits', TX_HASH],
  ['64 upper-case hex digits', `0x${'ABCDEF09'.repeat(8)}`],
  ['64 hex digits in mixed case', `0x${'aBcD'.repeat(16)}`]
]

const NOT_HASHES: [string, string][] = [
  ['63 hex digits', TX_HASH.slice(0, -1)],
  ['65 hex digits', `${TX_HASH}0`],
  ['0X with a capital X before 64 hex digits', `0X${TX_HASH.slice(2)}`],
  ['a space before it', ` ${TX_HASH}`],
  ['a space after it', `${TX_HASH} `],
  ['a line break after it', `${TX_HASH}\n`],
  ['a space in place of its first digit, at the length of a hash', `0x ${TX_HASH.slice(3)}`],
  ['a letter past f, at the length of a hash', `0x${'g'.repeat(64)}`]
]

/** ethers' error from `wait()` on a mined revert, carrying a node's JSON receipt. */
const minedAndRevertedWith = (receipt: Record<string, unknown>): Error =>
  Object.assign(new Error('transaction execution reverted'), { code: 'CALL_EXCEPTION', receipt })

/** A node's status-zero receipt with the fields given. */
const nodeReceipt = (fields: Record<string, unknown>) => ({
  transactionHash: TX_HASH,
  status: '0x0',
  ...fields
})

/** Thrown values that name `value`: a wait with no receipt, a mined revert with ethers' receipt and with a node's. */
const thrownNaming = (value: string): Error[] => [
  waitTimedOut(value as Hex),
  minedAndReverted(value as Hex),
  minedAndRevertedWith({ transactionHash: value, status: '0x0' })
]

describe('a transaction hash', () => {
  describe('a thrown value that names one waits for its receipt, and one with a status-zero receipt reads reverted', () => {
    HASHES.forEach(([name, hash]) =>
      it(name, () => {
        WRITE_KINDS.forEach((write) => {
          const [waiting, ethersReceipt, nodeShape] = thrownNaming(hash)
          expect(failThrown(write, waiting)).toEqual({
            status: 'submitting',
            write,
            transactionHash: hash
          })
          expect(failThrown(write, ethersReceipt)).toMatchObject({
            status: 'failedReverted',
            transactionHash: hash
          })
          expect(failThrown(write, nodeShape)).toMatchObject({
            status: 'failedReverted',
            transactionHash: hash
          })
        })
      })
    )
  })

  describe('a thrown value with anything else in its place, with a receipt or without, reads that nothing was sent', () => {
    NOT_HASHES.forEach(([name, value]) =>
      it(name, () => {
        WRITE_KINDS.forEach((write) =>
          thrownNaming(value).forEach((thrown) =>
            expect(readingOf(failThrown(write, thrown))).toBe('notSent')
          )
        )
      })
    )
  })
})

describe('the gas a mined revert spent, at a gas price of 2 gwei', () => {
  const spentWith = (gasUsed: unknown, price: Record<string, unknown>) =>
    WRITE_KINDS.map((write) =>
      failThrown(write, minedAndRevertedWith(nodeReceipt({ gasUsed, ...price })))
    )

  const QUANTITIES: [string, unknown, bigint][] = [
    ['0x0a', '0x0a', 10n],
    ['a hex string in upper case, 0xFF', '0xFF', 255n],
    ['0x0', '0x0', 0n],
    ['a string of decimal digits, 51234', '51234', 51_234n],
    ['a whole number, 51234', 51_234, 51_234n],
    ['a bigint, 51234', 51_234n, 51_234n]
  ]

  const NOT_QUANTITIES: [string, unknown][] = [
    ['0x alone', '0x'],
    ['0X with a capital X', '0X0a'],
    ['a hex string with a letter past f', '0x0g'],
    ['a negative decimal string', '-5'],
    ['a negative hex string', '-0x5']
  ]

  QUANTITIES.forEach(([name, value, gas]) =>
    it(`gas used as ${name} is read`, () => {
      spentWith(value, { effectiveGasPrice: '2000000000' }).forEach((state) =>
        expect(state).toMatchObject({ status: 'failedReverted', gasSpent: gas * 2n * GWEI })
      )
    })
  )

  NOT_QUANTITIES.forEach(([name, value]) =>
    it(`gas used as ${name} is left out: the write reads reverted and names no gas spent`, () => {
      spentWith(value, { effectiveGasPrice: '2000000000' }).forEach((state) => {
        expect(readingOf(state)).toBe('reverted')
        expect(state).not.toHaveProperty('gasSpent')
      })
    })
  )

  it('a gas price in hex stands in for a missing effective gas price', () => {
    spentWith('0x0a', { gasPrice: '0x77359400' }).forEach((state) =>
      expect(state).toMatchObject({ status: 'failedReverted', gasSpent: 20n * GWEI })
    )
  })
})
