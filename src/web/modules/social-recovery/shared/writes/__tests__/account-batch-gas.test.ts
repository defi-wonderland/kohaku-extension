/**
 * The gas check of a save the account runs as one batch, over the transaction
 * the client builds for it through the account library
 * (`accountBatchTransactionOf`): the account's own execute where it has code,
 * the factory's deploy-and-execute where it has none. The account is the
 * library's own, controlled by the sending key.
 */
import type { Account } from '@ambire-common/interfaces/account'
import { dedicatedToOneSAPriv } from '@ambire-common/interfaces/keystore'
import { getSmartAccount } from '@ambire-common/libs/account/account'
import type { Network } from '@ambire-common/interfaces/network'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import {
  accountBatchTransactionOf,
  isProviderReadFailure,
  isRevertedCall
} from '@web/modules/social-recovery/shared/client'

import {
  ACCOUNT_FACTORY,
  GWEI,
  initialWriteState,
  KEY,
  mockReads,
  nodeRevert,
  readingOf,
  rpcReads,
  runGasCheck,
  SAVE,
  stepOf,
  writeReducer
} from './harness'

const SEPOLIA = { chainId: 11155111n, name: 'Sepolia' } as Network

let account: Account

beforeAll(async () => {
  account = await getSmartAccount([{ addr: KEY.addr, hash: dedicatedToOneSAPriv }], [])
})

/** The account's state as the wallet reads it, with or without code. */
const stateOf = (isDeployed: boolean) =>
  ({
    accountAddr: account.addr,
    isDeployed,
    isEOA: false,
    isV2: true,
    nonce: 0n
  } as never)

const transactionFor = (deployed: boolean) =>
  accountBatchTransactionOf(
    { account, state: stateOf(deployed), network: SEPOLIA },
    KEY,
    SAVE.calls
  )

const operatesFor = (deployed: boolean) => ({
  address: account.addr as Address,
  name: 'Account 1',
  deployed
})

describe("the gas check of an account's batch, over the library's transaction", () => {
  const STATES: [string, boolean][] = [
    ['with code', true],
    ['with no code yet', false]
  ]
  STATES.forEach(([title, deployed]) =>
    describe(`for an account ${title}`, () => {
      it('estimates that transaction itself, and answers enough for a key that holds enough', async () => {
        const transaction = transactionFor(deployed)
        const reads = mockReads({ balance: 10n ** 18n, gas: 250_000n })
        const check = await runGasCheck({
          write: 'save',
          prepared: SAVE,
          transaction,
          operates: operatesFor(deployed),
          reads
        })
        expect(check.kind).toBe('enough')
        expect(reads.estimateGas).toHaveBeenCalledTimes(1)
        expect(reads.estimateGas).toHaveBeenCalledWith(transaction)
        expect(reads.nativeBalance).toHaveBeenCalledWith(KEY.addr)
      })

      it('answers the deposit step for a key that holds too little', async () => {
        const reads = mockReads({ balance: 0n, gas: 250_000n, price: 2n * GWEI })
        const step = stepOf(
          await runGasCheck({
            write: 'save',
            prepared: SAVE,
            transaction: transactionFor(deployed),
            operates: operatesFor(deployed),
            reads
          })
        )
        expect(step.estimate.gas).toBe(250_000n)
        expect(step.key).toBe(KEY.addr)
      })
    })
  )

  it('sends the undeployed transaction to the factory the check accepts', () => {
    expect(transactionFor(false).to).toBe(ACCOUNT_FACTORY)
  })

  it('prices the transfer route for an account with code, and drops it for one with none', async () => {
    const short = () => mockReads({ balance: 0n, gas: 250_000n })
    const withCode = stepOf(
      await runGasCheck({
        write: 'save',
        prepared: SAVE,
        transaction: transactionFor(true),
        operates: operatesFor(true),
        reads: short()
      })
    )
    expect(withCode.routes.map((route) => route.kind)).toEqual(['transfer', 'outside'])
    const noCode = stepOf(
      await runGasCheck({
        write: 'save',
        prepared: SAVE,
        transaction: transactionFor(false),
        operates: operatesFor(false),
        reads: short()
      })
    )
    expect(noCode.routes.map((route) => route.kind)).toEqual(['outside'])
  })

  // The undeployed transaction carries the library's simulation signature,
  // which the account accepts only from the simulation origins; a node that
  // estimates it from the key reverts. The check reads that revert as a call
  // never sent, not as a read that could not run.
  it('reads an estimate of the undeployed transaction that reverts as never sent', async () => {
    const thrown = await runGasCheck({
      write: 'save',
      prepared: SAVE,
      transaction: transactionFor(false),
      operates: operatesFor(false),
      reads: rpcReads({ balance: 10n ** 18n, gas: nodeRevert() })
    }).catch((error: unknown) => error)
    expect(isRevertedCall(thrown)).toBe(true)
    expect(isProviderReadFailure(thrown)).toBe(false)
    const checking = writeReducer(initialWriteState('save'), { type: 'start' })
    const state = writeReducer(checking, { type: 'error', run: checking.run, error: thrown })
    expect(readingOf(state)).toBe('notSent')
  })

  it("refuses the library's transaction when another key is said to send it", async () => {
    const reads = mockReads({ balance: 10n ** 18n, gas: 250_000n })
    await expect(
      runGasCheck({
        write: 'save',
        prepared: SAVE,
        key: { addr: '0x2b0f5e98ee98adc9865745e98802f333f72f6ef5', type: 'internal' },
        transaction: transactionFor(true),
        operates: operatesFor(true),
        reads
      })
    ).rejects.toThrow(TypeError)
    expect(reads.estimateGas).not.toHaveBeenCalled()
  })
})
