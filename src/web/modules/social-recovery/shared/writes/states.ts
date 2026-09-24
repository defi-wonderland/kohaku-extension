/**
 * The states every write of the chapter shares (ux.md D-319): the gas check
 * and its deposit step, the one submitting state, and the one failed state
 * with its two readings, each a state of its own.
 *
 * Every write renders these and no write defines its own: the setup save, any
 * other setup write, the owner's cancel, the submission and the execution.
 */
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'

import type { RevertCause, WriteReceipt } from './classify'
import type { DepositStep } from './gas'
import type { WriteKind } from './kinds'

/** Every status of a write, in the order a write passes them. */
export const WRITE_STATUSES = [
  'idle',
  'checkingGas',
  'needsDeposit',
  'submitting',
  'landed',
  'failedNotSent',
  'failedReverted'
] as const
export type WriteStatus = typeof WRITE_STATUSES[number]

/** The two readings of the one failed state (D-319), each its own status. */
export const FAILED_STATUSES = ['failedNotSent', 'failedReverted'] as const
export type FailedStatus = typeof FAILED_STATUSES[number]

/** Nothing asked yet. */
export interface IdleState {
  status: 'idle'
  write: WriteKind
}

/** The gas check runs: the estimate, the gas price and the sending key's balance. */
export interface CheckingGasState {
  status: 'checkingGas'
  write: WriteKind
}

/** The sending key holds too little: the deposit step, rather than a failed transaction. */
export interface NeedsDepositState {
  status: 'needsDeposit'
  write: WriteKind
  step: DepositStep
}

/**
 * The one submitting state. `transactionHash` is present once the wallet
 * broadcast the call; the state holds until its receipt comes back.
 */
export interface SubmittingState {
  status: 'submitting'
  write: WriteKind
  transactionHash?: Hex
}

/** The call ran: a receipt with status one. */
export interface LandedState {
  status: 'landed'
  write: WriteKind
  transactionHash: Hex
  receipt: WriteReceipt
}

/**
 * The first reading of the failed state: the wallet never sent the call, so
 * nothing reached the chain and the account stands as it did. `error` is what
 * the wallet met before any transaction hash: a refused signature, a gas
 * estimate that would revert, a read or a broadcast that failed.
 */
export interface FailedNotSentState {
  status: 'failedNotSent'
  write: WriteKind
  error: unknown
}

/**
 * The second reading of the failed state: the call reached the chain and
 * reverted. It names the cause the receipt carries, and the gas it spent is
 * gone (`gasSpent` where the receipt carries both factors).
 */
export interface FailedRevertedState {
  status: 'failedReverted'
  write: WriteKind
  transactionHash: Hex
  receipt: WriteReceipt
  cause: RevertCause
  gasSpent?: bigint
}

/** The one failed state, with its two readings. */
export type FailedState = FailedNotSentState | FailedRevertedState

/** Every state of a write. */
export type WriteState =
  | IdleState
  | CheckingGasState
  | NeedsDepositState
  | SubmittingState
  | LandedState
  | FailedState

export const isFailedState = (state: WriteState): state is FailedState =>
  (FAILED_STATUSES as readonly string[]).includes(state.status)

/**
 * Whether the failed state offers the retry. Every failed state does but a
 * cancel whose attempt was already gone: nothing is left to cancel, D-307.
 */
export const canRetry = (state: WriteState): boolean =>
  state.status === 'failedNotSent' ||
  (state.status === 'failedReverted' && state.cause.kind !== 'attemptGone')

/**
 * Whether the failed state offers the cancel's move-funds action (D-307 and
 * the cancel's failed states of frame D2-01). A cancel the wallet never sent
 * offers it beside the retry, since the waiting period keeps running. A cancel
 * that reverted because the attempt executed offers it beside the controller
 * the state names. A cancel another road beat keeps control unchanged and
 * offers none, and neither does a gone attempt whose read has not returned.
 * No other write offers it.
 */
export const offersMoveFunds = (state: WriteState): boolean => {
  if (state.write !== 'cancel') return false
  if (state.status === 'failedNotSent') return true
  return (
    state.status === 'failedReverted' &&
    state.cause.kind === 'attemptGone' &&
    state.cause.ended === 'executed'
  )
}
