/**
 * A screen may reset a write, or retry it, while the answers of the run before
 * are still on their way. Each `start` opens a new run, and the machine takes
 * only the answers of the current run: a late receipt, error, gas check or
 * attempt read of an earlier run leaves the state as it was. So a late landed
 * receipt of a cancel the holder left behind never hides the revert of the
 * cancel that followed it.
 */
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'

import {
  canRetry,
  CONTROLLER,
  depositStepFor,
  enoughCheck,
  initialWriteState,
  offersMoveFunds,
  readingOf,
  REPLACEMENT_HASH,
  sentFrom,
  TX_HASH,
  userRejected,
  writeReducer,
  WriteMachineState
} from './harness'

const HASH_A = TX_HASH
const HASH_B: Hex = `0x${'b'.repeat(64)}`

/** A cancel sent with hash A, reset by the holder, then sent again with hash B. */
const cancelSentAgain = () => {
  const first = sentFrom(initialWriteState('cancel'), HASH_A)
  const second = sentFrom(writeReducer(first, { type: 'reset' }), HASH_B)
  return { first, second }
}

/** A cancel whose first run reverted, retried, and sent again with hash B. */
const cancelRetried = () => {
  const sent = sentFrom(initialWriteState('cancel'), HASH_A)
  const reverted = writeReducer(sent, {
    type: 'receipt',
    run: sent.run,
    receipt: { transactionHash: HASH_A, status: 0 }
  })
  const second = sentFrom(reverted, HASH_B)
  return { first: sent, reverted, second }
}

describe('an answer of an earlier run', () => {
  it('each start opens a new run, and a reset keeps the count', () => {
    const { first, second } = cancelSentAgain()
    expect(second.run).toBeGreaterThan(first.run)
    expect(second).toMatchObject({ status: 'submitting', transactionHash: HASH_B })
    expect(writeReducer(second, { type: 'reset' }).run).toBe(second.run)
  })

  it('a late receipt from the previous run is ignored', () => {
    const { first, second } = cancelSentAgain()
    const late = writeReducer(second, {
      type: 'receipt',
      run: first.run,
      receipt: { transactionHash: HASH_A, status: 1 }
    })
    expect(late).toBe(second)
    expect(readingOf(late)).not.toBe('landed')
  })

  it('the reverted receipt of the current run reaches the reverted reading after a late landed receipt', () => {
    const { first, second } = cancelSentAgain()
    const late = writeReducer(second, {
      type: 'receipt',
      run: first.run,
      receipt: { transactionHash: HASH_A, status: 1 }
    })
    const settled = writeReducer(late, {
      type: 'receipt',
      run: second.run,
      receipt: { transactionHash: HASH_B, status: 0 }
    })
    expect(readingOf(settled)).toBe('reverted')
    expect(settled).toMatchObject({ transactionHash: HASH_B, run: second.run })
    expect(canRetry(settled)).toBe(true)
    expect(offersMoveFunds(settled)).toBe(true)
  })

  it('a late error from the previous run is ignored', () => {
    const { first, second } = cancelSentAgain()
    expect(writeReducer(second, { type: 'error', run: first.run, error: userRejected() })).toBe(
      second
    )
    const checking = writeReducer(writeReducer(first, { type: 'reset' }), { type: 'start' })
    expect(writeReducer(checking, { type: 'error', run: first.run, error: userRejected() })).toBe(
      checking
    )
  })

  it('a late error from the run a retry left behind is ignored', () => {
    const { first, second } = cancelRetried()
    expect(writeReducer(second, { type: 'error', run: first.run, error: userRejected() })).toBe(
      second
    )
  })

  it('a late gas result from the previous run is ignored', async () => {
    const first = writeReducer(initialWriteState('cancel'), { type: 'start' })
    const checking = writeReducer(writeReducer(first, { type: 'reset' }), { type: 'start' })
    const deposit = { kind: 'deposit' as const, step: await depositStepFor('cancel', false) }
    expect(
      writeReducer(checking, { type: 'gasChecked', run: first.run, check: enoughCheck('cancel') })
    ).toBe(checking)
    expect(writeReducer(checking, { type: 'gasChecked', run: first.run, check: deposit })).toBe(
      checking
    )
    expect(
      writeReducer(checking, {
        type: 'gasChecked',
        run: checking.run,
        check: enoughCheck('cancel')
      }).status
    ).toBe('submitting')
  })

  it('a late attempt read from the previous run does not judge the current cancel again', () => {
    const { reverted, second } = cancelRetried()
    const current = writeReducer(second, {
      type: 'receipt',
      run: second.run,
      receipt: { transactionHash: HASH_B, status: 0 }
    })
    const executed = { ended: 'executed' as const, controller: CONTROLLER }
    expect(
      writeReducer(current, { type: 'attemptRead', run: reverted.run, attemptAfter: executed })
    ).toBe(current)
    expect(
      writeReducer(current, { type: 'attemptRead', run: current.run, attemptAfter: executed })
    ).toMatchObject({ cause: { kind: 'attemptGone', ended: 'executed' }, run: current.run })
  })
})

describe('an answer of the current run', () => {
  it('a repriced replacement receipt within the current run still lands', () => {
    const { second } = cancelSentAgain()
    const landed = writeReducer(second, {
      type: 'receipt',
      run: second.run,
      receipt: { transactionHash: REPLACEMENT_HASH, status: 1 }
    })
    expect(readingOf(landed)).toBe('landed')
    expect(landed).toMatchObject({ transactionHash: REPLACEMENT_HASH, run: second.run })
  })

  it('a second hash within the run replaces the first', () => {
    const { second } = cancelSentAgain()
    const resent = writeReducer(second, {
      type: 'sent',
      run: second.run,
      transactionHash: REPLACEMENT_HASH
    })
    expect(resent).toMatchObject({ status: 'submitting', transactionHash: REPLACEMENT_HASH })
  })

  it("the deposit step's recheck stays in the run, so the check it runs still answers", async () => {
    const checking = writeReducer(initialWriteState('cancel'), { type: 'start' })
    const step = await depositStepFor('cancel', false)
    const needsDeposit: WriteMachineState = writeReducer(checking, {
      type: 'gasChecked',
      run: checking.run,
      check: { kind: 'deposit', step }
    })
    expect(needsDeposit.status).toBe('needsDeposit')
    const rechecking = writeReducer(needsDeposit, { type: 'recheck' })
    expect(rechecking).toMatchObject({ status: 'checkingGas', run: checking.run })
    expect(
      writeReducer(rechecking, {
        type: 'gasChecked',
        run: checking.run,
        check: enoughCheck('cancel')
      }).status
    ).toBe('submitting')
  })
})
