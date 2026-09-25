/**
 * The write machine: one pure reducer over the shared states (states.ts).
 *
 *                     ┌──error(read failed)──▶ gasReadError ───start──┐
 *                     │                                                 │
 *   idle ──start──▶ checkingGas ◀──────────────────────────────────────┘
 *                     │  ▲   └──gasChecked(enough)──▶ submitting ──sent──▶ submitting(hash)
 *  gasChecked(deposit)│  │recheck                            │
 *                     ▼  │                          receipt / error
 *                needsDeposit                                ▼
 *                                          landed | failedNotSent | failedReverted
 *
 * A failed state that offers the retry goes back to `checkingGas` on `start`,
 * since a retry runs the gas check again at that moment's fee. A read of the
 * gas check that could not run (a `ProviderReadFailure`) is `gasReadError`,
 * never the not-sent reading (D-393). An event a state does not take leaves
 * the state as it was (the same object), so a late answer of an earlier run
 * never moves the screen.
 */
import type { Hex, KitError } from '@web/modules/social-recovery/sdk-interfaces'
import { isProviderReadFailure } from '@web/modules/social-recovery/shared/client'

import {
  AttemptAfterCancel,
  classifyFailure,
  revertCauseOf,
  settleReceipt,
  WriteReceipt,
  writeFailureOf
} from './classify'
import type { GasCheck } from './gas'
import type { WriteKind } from './kinds'
import { canRetry, IdleState, WriteState } from './states'

/** What moves a write. */
export type WriteEvent =
  /** Runs the gas check: from `idle`, or from a state that offers the retry. */
  | { type: 'start' }
  /** The gas check answered: `enough` sends, `deposit` shows the step. */
  | { type: 'gasChecked'; check: GasCheck }
  /** From the deposit step: run the check again, since the funds may have arrived. */
  | { type: 'recheck' }
  /** The wallet broadcast the call. */
  | { type: 'sent'; transactionHash: Hex }
  /** A receipt came back, with the revert's decoded cause where the wallet read one. */
  | { type: 'receipt'; receipt: WriteReceipt; cause?: KitError; attemptAfter?: AttemptAfterCancel }
  /** The gas check or the send threw; the hash is the one the wallet holds, where it holds one. */
  | {
      type: 'error'
      error: unknown
      transactionHash?: Hex
      cause?: KitError
      attemptAfter?: AttemptAfterCancel
    }
  /** The attempt read after a cancel's revert returned (D-307). */
  | { type: 'attemptRead'; attemptAfter: AttemptAfterCancel }
  /** Back to `idle`. */
  | { type: 'reset' }

export const WRITE_EVENT_TYPES = [
  'start',
  'gasChecked',
  'recheck',
  'sent',
  'receipt',
  'error',
  'attemptRead',
  'reset'
] as const

/** The state a write starts in. */
export const initialWriteState = (write: WriteKind): IdleState => ({ status: 'idle', write })

/** The reducer of a write. Pure: the same state and event always answer the same state. */
export const writeReducer = (state: WriteState, event: WriteEvent): WriteState => {
  const { write } = state
  switch (event.type) {
    case 'start':
      if (state.status === 'idle' || canRetry(state)) return { status: 'checkingGas', write }
      return state

    case 'gasChecked':
      if (state.status !== 'checkingGas') return state
      // A check made for another write is a late answer of another screen's run.
      if ((event.check.kind === 'enough' ? event.check.write : event.check.step.write) !== write) {
        return state
      }
      return event.check.kind === 'enough'
        ? { status: 'submitting', write }
        : { status: 'needsDeposit', write, step: event.check.step }

    case 'recheck':
      return state.status === 'needsDeposit' ? { status: 'checkingGas', write } : state

    case 'sent':
      return state.status === 'submitting'
        ? { status: 'submitting', write, transactionHash: event.transactionHash }
        : state

    case 'receipt':
      if (state.status !== 'submitting') return state
      return settleReceipt(event.receipt, { write, attemptAfter: event.attemptAfter }, event.cause)

    case 'error': {
      if (state.status !== 'checkingGas' && state.status !== 'submitting') return state
      // A read of the gas check that could not run: the check runs again (D-393).
      if (state.status === 'checkingGas' && isProviderReadFailure(event.error)) {
        return { status: 'gasReadError', write, error: event.error }
      }
      const context = { write, attemptAfter: event.attemptAfter }
      const found = writeFailureOf(event.error)
      // A call another transaction replaced never ran, whatever the replacement did.
      if (found.replaced) return classifyFailure(found, context)
      // An error that carries its receipt (ethers' `CALL_EXCEPTION` from `wait()`,
      // or a repriced replacement's) settles by it.
      if (found.receipt) return settleReceipt(found.receipt, context, event.cause)
      const transactionHash =
        found.transactionHash ??
        event.transactionHash ??
        (state.status === 'submitting' ? state.transactionHash : undefined)
      return classifyFailure(
        { error: event.error, ...(transactionHash ? { transactionHash } : {}) },
        context
      )
    }

    case 'attemptRead':
      // The attempt read judges a reverted cancel again: gone, with its road and
      // controller, or still running, the plain reverted reading (D-307).
      if (state.status !== 'failedReverted' || state.write !== 'cancel') return state
      return { ...state, cause: revertCauseOf(write, state.decoded, event.attemptAfter) }

    case 'reset':
      return state.status === 'idle' ? state : { status: 'idle', write }

    default:
      return state
  }
}
