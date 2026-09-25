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
 * never the not-sent reading: the write was never about to be sent.
 *
 * Each accepted `start` opens a new run, one more than the last. Every answer
 * of the work a run started (`WRITE_ANSWER_TYPES`: the gas check, the hash,
 * the receipt, an error, the attempt read) carries the run it belongs to, and
 * the reducer drops an answer of another run. So a late receipt of a
 * transaction the holder left behind never settles the run after it. End a run
 * with `reset`, not with a fresh `initialWriteState`: a fresh state counts its
 * runs from zero again, so a late answer could match a new run.
 *
 * An event a state does not take leaves the state as it was (the same object).
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

/** The run a state belongs to: 0 before the first `start`, one more at each accepted `start`. */
export interface WriteRun {
  run: number
}

/** A write's state in the machine: one of the shared states, with its run. */
export type WriteMachineState = WriteState & WriteRun

/** What moves a write. */
export type WriteEvent =
  /** Runs the gas check and opens a new run: from `idle`, or from a state that offers the retry. */
  | { type: 'start' }
  /** The gas check answered: `enough` sends, `deposit` shows the step. */
  | { type: 'gasChecked'; run: number; check: GasCheck }
  /** From the deposit step: run the check again in the same run, since the funds may have arrived. */
  | { type: 'recheck' }
  /** The wallet broadcast the call. */
  | { type: 'sent'; run: number; transactionHash: Hex }
  /** A receipt came back, with the revert's decoded cause where the wallet read one. */
  | {
      type: 'receipt'
      run: number
      receipt: WriteReceipt
      cause?: KitError
      attemptAfter?: AttemptAfterCancel
    }
  /** The gas check or the send threw; the hash is the one the wallet holds, where it holds one. */
  | {
      type: 'error'
      run: number
      error: unknown
      transactionHash?: Hex
      cause?: KitError
      attemptAfter?: AttemptAfterCancel
    }
  /** The attempt read after a cancel's revert returned. */
  | { type: 'attemptRead'; run: number; attemptAfter: AttemptAfterCancel }
  /** Back to `idle`, keeping the run count. */
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

/** The events that answer the work of a run, and so carry the run they belong to. */
export const WRITE_ANSWER_TYPES = ['gasChecked', 'sent', 'receipt', 'error', 'attemptRead'] as const

type WriteAnswer = Extract<WriteEvent, { type: typeof WRITE_ANSWER_TYPES[number] }>

const isAnswer = (event: WriteEvent): event is WriteAnswer =>
  (WRITE_ANSWER_TYPES as readonly string[]).includes(event.type)

/** The state a write starts in. */
export const initialWriteState = (write: WriteKind): IdleState & WriteRun => ({
  status: 'idle',
  write,
  run: 0
})

/** The reducer of a write. Pure: the same state and event always answer the same state. */
export const writeReducer = (state: WriteMachineState, event: WriteEvent): WriteMachineState => {
  const { write, run } = state
  if (isAnswer(event) && event.run !== run) return state
  switch (event.type) {
    case 'start':
      if (state.status === 'idle' || canRetry(state)) {
        return { status: 'checkingGas', write, run: run + 1 }
      }
      return state

    case 'gasChecked':
      if (state.status !== 'checkingGas') return state
      // A check made for another write kind is not this write's.
      if ((event.check.kind === 'enough' ? event.check.write : event.check.step.write) !== write) {
        return state
      }
      return event.check.kind === 'enough'
        ? { status: 'submitting', write, run }
        : { status: 'needsDeposit', write, step: event.check.step, run }

    case 'recheck':
      return state.status === 'needsDeposit' ? { status: 'checkingGas', write, run } : state

    case 'sent':
      // A second hash in the same run replaces the first: the wallet sent the
      // same call again at another fee.
      return state.status === 'submitting'
        ? { status: 'submitting', write, transactionHash: event.transactionHash, run }
        : state

    case 'receipt':
      if (state.status !== 'submitting') return state
      // The receipt may name another hash than the one sent: within the run,
      // that is a repriced replacement of the same call, so it settles the write.
      return {
        ...settleReceipt(event.receipt, { write, attemptAfter: event.attemptAfter }, event.cause),
        run
      }

    case 'error': {
      if (state.status !== 'checkingGas' && state.status !== 'submitting') return state
      if (state.status === 'checkingGas' && isProviderReadFailure(event.error)) {
        return { status: 'gasReadError', write, error: event.error, run }
      }
      const context = { write, attemptAfter: event.attemptAfter }
      const found = writeFailureOf(event.error)
      // A call another transaction replaced never ran, whatever the replacement did.
      if (found.replaced) return { ...classifyFailure(found, context), run }
      // An error that carries its receipt (ethers' `CALL_EXCEPTION` from `wait()`,
      // or a repriced replacement's) settles by it.
      if (found.receipt) return { ...settleReceipt(found.receipt, context, event.cause), run }
      const transactionHash =
        found.transactionHash ??
        event.transactionHash ??
        (state.status === 'submitting' ? state.transactionHash : undefined)
      return {
        ...classifyFailure(
          { error: event.error, ...(transactionHash ? { transactionHash } : {}) },
          context
        ),
        run
      }
    }

    case 'attemptRead':
      // The attempt read judges a reverted cancel again: gone, with its road and
      // controller, or still running, the plain reverted reading.
      if (state.status !== 'failedReverted' || state.write !== 'cancel') return state
      return { ...state, cause: revertCauseOf(write, state.decoded, event.attemptAfter) }

    case 'reset':
      // The run count stays, so the next `start` opens a run no late answer belongs to.
      return state.status === 'idle' ? state : { status: 'idle', write, run }

    default:
      return state
  }
}
