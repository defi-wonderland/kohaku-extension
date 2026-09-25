/**
 * The classification of a write's end: landed, or one of the two readings of
 * the failed state every write of the chapter inherits (ux.md D-319).
 *
 * - A call the wallet never sent, an error before any transaction hash, reads
 *   that nothing reached the chain and the account stands as it did.
 * - A call that reached the chain and reverted, a receipt with status zero,
 *   reads as a revert, names the cause the receipt carries and says the gas it
 *   spent is gone.
 *
 * The two are distinct states, never one state with a flag: a holder who reads
 * that the wallet sent nothing retries a call that cannot land. The owner's
 * cancel adds its own reading of the revert (ux.md D-307): the attempt is
 * already gone, with the account's controller as it now stands. That reading
 * rests on the attempt read after the revert, or on a decoded cause that says
 * nothing was left to cancel, never on a revert the wallet could not decode.
 *
 * A transaction hash with no receipt is neither reading. The call may still
 * land, so it stays in the submitting state and keeps waiting for its receipt.
 */
import type {
  Address,
  Hex,
  KitError,
  KitErrorName
} from '@web/modules/social-recovery/sdk-interfaces'
import { CANCELLED_BY, KIT_ERROR_NAMES } from '@web/modules/social-recovery/sdk-interfaces'

import type { WriteKind } from './kinds'
import type {
  FailedNotSentState,
  FailedRevertedState,
  FailedState,
  LandedState,
  SubmittingState
} from './states'

// ---------------------------------------------------------------------------
// Receipts and failures
// ---------------------------------------------------------------------------

/** The part of a transaction receipt this lane reads. */
export interface WriteReceipt {
  transactionHash: Hex
  /** 1 for a call that ran, 0 for a call that reverted. */
  status: 0 | 1
  blockNumber?: number
  gasUsed?: bigint
  effectiveGasPrice?: bigint
}

/**
 * How a sent transaction was replaced before it was mined, where it was not
 * merely repriced (ethers' `TRANSACTION_REPLACED`): `cancelled`, replaced by a
 * transaction that sends nothing, or `replaced`, by another transaction. The
 * write's own call never ran.
 */
export const REPLACED_REASONS = ['cancelled', 'replaced'] as const
export type ReplacedReason = typeof REPLACED_REASONS[number]

/**
 * What the wallet knows of a write that did not land. `error` is what the send
 * threw; `transactionHash` is present once the wallet broadcast the call;
 * `receipt` is present once one came back; `cause` is the revert the wallet
 * decoded for that receipt (the SDK's error decoding over the call), where it
 * read one; `replaced` is present where another transaction took the call's
 * place before it was mined.
 */
export interface WriteFailure {
  error?: unknown
  transactionHash?: Hex
  receipt?: WriteReceipt
  cause?: KitError
  replaced?: ReplacedReason
}

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/

const isTransactionHash = (value: unknown): value is Hex =>
  typeof value === 'string' && HASH_PATTERN.test(value)

const statusOf = (value: unknown): 0 | 1 | undefined => {
  if (value === 0 || value === 0n || value === '0x0' || value === '0x00' || value === false)
    return 0
  if (value === 1 || value === 1n || value === '0x1' || value === '0x01' || value === true) return 1
  return undefined
}

const bigintOf = (value: unknown): bigint | undefined => {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) return BigInt(value)
  return undefined
}

/**
 * Reads a receipt from what a provider answered: ethers' `TransactionReceipt`
 * (`hash`, a numeric `status`) or a node's JSON receipt (`transactionHash`, a
 * quantity `status`). Answers undefined for a value that is not a receipt with
 * a known status, so a pre-Byzantium receipt with no status is never read as
 * either reading.
 */
export const receiptOf = (value: unknown): WriteReceipt | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const transactionHash = isTransactionHash(record.transactionHash)
    ? record.transactionHash
    : isTransactionHash(record.hash)
    ? record.hash
    : undefined
  const status = statusOf(record.status)
  if (!transactionHash || status === undefined) return undefined
  const blockNumber = bigintOf(record.blockNumber)
  const gasUsed = bigintOf(record.gasUsed)
  const effectiveGasPrice = bigintOf(record.effectiveGasPrice ?? record.gasPrice)
  return {
    transactionHash,
    status,
    ...(blockNumber !== undefined ? { blockNumber: Number(blockNumber) } : {}),
    ...(gasUsed !== undefined ? { gasUsed } : {}),
    ...(effectiveGasPrice !== undefined ? { effectiveGasPrice } : {})
  }
}

const isReplacedReason = (value: unknown): value is ReplacedReason =>
  typeof value === 'string' && (REPLACED_REASONS as readonly string[]).includes(value)

/**
 * Reads what a thrown value tells about the call:
 *
 * - ethers' `TRANSACTION_REPLACED`: a `repriced` replacement is the same call
 *   at another fee, so it settles by the replacement's receipt; a `cancelled`
 *   or `replaced` one means the call never ran, whatever the replacement's
 *   receipt says, so it carries that reason and no receipt;
 * - a receipt it carries (ethers' `CALL_EXCEPTION` from `wait()` carries the
 *   reverted receipt);
 * - the hash of a transaction it names (`transactionHash`, `hash`,
 *   `transaction.hash`).
 *
 * A value that carries none of these is an error before any hash.
 */
export const writeFailureOf = (thrown: unknown): WriteFailure => {
  const seen = new Set<unknown>()
  let receipt: WriteReceipt | undefined
  let transactionHash: Hex | undefined
  let replaced: ReplacedReason | undefined

  const visit = (value: unknown, depth: number): void => {
    if (depth > 4 || !value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    const record = value as Record<string, unknown>
    if (record.code === 'TRANSACTION_REPLACED' && !replaced && !receipt) {
      if (isReplacedReason(record.reason)) {
        replaced = record.reason
        return
      }
      if (record.reason === 'repriced') receipt = receiptOf(record.receipt)
    }
    if (!receipt) receipt = receiptOf(record.receipt)
    if (!transactionHash) {
      if (isTransactionHash(record.transactionHash)) transactionHash = record.transactionHash
      else if (isTransactionHash(record.hash)) transactionHash = record.hash
    }
    ;['transaction', 'info', 'error', 'cause'].forEach((key) => visit(record[key], depth + 1))
  }

  visit(thrown, 0)
  if (replaced) return { error: thrown, replaced }
  return {
    error: thrown,
    ...(receipt ? { receipt, transactionHash: receipt.transactionHash } : {}),
    ...(!receipt && transactionHash ? { transactionHash } : {})
  }
}

// ---------------------------------------------------------------------------
// The causes of a revert
// ---------------------------------------------------------------------------

/**
 * How the attempt a reverted cancel meant to end had already ended, as the
 * attempt read after the revert names it: executed, or cancelled by one of the
 * roads the manager's cancel event names (events.ts `CANCELLED_BY`).
 */
export const ATTEMPT_ENDS = ['executed', ...CANCELLED_BY] as const
export type AttemptEnd = typeof ATTEMPT_ENDS[number]

/** The attempt read's answer where the attempt a cancel meant to end still runs. */
export const ATTEMPT_STILL_RUNNING = 'stillRunning' as const

/**
 * The attempt read after a reverted cancel (ux.md D-307): how the attempt had
 * ended and the account's controller as it now stands, or that it still runs.
 * The controller is the key the consume event handed the account after an
 * execution, and the account's own key where another road ended the attempt.
 * An attempt that still runs reads the plain reverted reading, with the retry
 * and the move-funds action, since the attack goes on.
 */
export type AttemptAfterCancel =
  | { ended: AttemptEnd; controller?: Address }
  | { ended: typeof ATTEMPT_STILL_RUNNING }

/**
 * The cause a reverted state names.
 *
 * - `named`: a kit error of sdk.md D-205 the wallet decoded, which it names in
 *   its own words.
 * - `unnamed`: a revert that carries no cause the wallet can name, with its raw
 *   data where it read any.
 * - `attemptGone`: the owner's cancel reverted because the attempt was already
 *   gone (D-307). `ended` names the road, and `controller` the account's
 *   controller after an execution, once the attempt read returned; before it,
 *   the state names no controller rather than one it guessed.
 */
export type RevertCause =
  | { kind: 'named'; name: KitErrorName; error: KitError }
  | { kind: 'unnamed'; data?: Hex }
  | { kind: 'attemptGone'; ended?: AttemptEnd; controller?: Address }

export const REVERT_CAUSE_KINDS = ['named', 'unnamed', 'attemptGone'] as const

const isKitErrorName = (name: string): name is KitErrorName =>
  (KIT_ERROR_NAMES as readonly string[]).includes(name)

/** The kit error of the decoded cause, where the wallet decoded one it knows. */
export const kitErrorNameOf = (cause?: KitError): KitErrorName | undefined =>
  cause?.kind === 'known' && isKitErrorName(cause.name) ? cause.name : undefined

const plainCause = (cause?: KitError): RevertCause => {
  const known = kitErrorNameOf(cause)
  if (known !== undefined && cause) return { kind: 'named', name: known, error: cause }
  return cause?.kind === 'unknown' ? { kind: 'unnamed', data: cause.data } : { kind: 'unnamed' }
}

/**
 * The cause of a revert for a write.
 *
 * A reverted cancel reads that the attempt was already gone (D-307) only on
 * one of three grounds:
 *
 * - the attempt read after the revert says the attempt ended, which also names
 *   the road and, after an execution, the controller;
 * - no read yet, and the decoded cause is `NoActiveAttempt`: nothing was left
 *   to cancel, road unknown until the read returns;
 * - no read yet, and the decoded cause is `NoSetup`: a setup write cleared the
 *   setup, which ended the attempt, so the road is the setup write.
 *
 * An attempt read that says the attempt still runs, and any cancel revert the
 * wallet could not decode or that names another kit error, reads the plain
 * reverted reading, with the retry and the move-funds action: an owner whose
 * cancel ran out of gas while the attack runs must not read that nothing is
 * left to cancel. Every other write names the kit error it decoded, or reads as
 * a revert with no cause it can name.
 */
export const revertCauseOf = (
  write: WriteKind,
  cause?: KitError,
  attemptAfter?: AttemptAfterCancel
): RevertCause => {
  if (write !== 'cancel') return plainCause(cause)
  if (attemptAfter) {
    if (attemptAfter.ended === ATTEMPT_STILL_RUNNING) return plainCause(cause)
    return {
      kind: 'attemptGone',
      ended: attemptAfter.ended,
      ...(attemptAfter.controller ? { controller: attemptAfter.controller } : {})
    }
  }
  const known = kitErrorNameOf(cause)
  if (known === 'NoActiveAttempt') return { kind: 'attemptGone' }
  if (known === 'NoSetup') return { kind: 'attemptGone', ended: 'setupWrite' }
  return plainCause(cause)
}

/** The gas a reverted receipt spent, where the receipt carries both factors. */
export const gasSpentOf = (receipt: WriteReceipt): bigint | undefined =>
  receipt.gasUsed !== undefined && receipt.effectiveGasPrice !== undefined
    ? receipt.gasUsed * receipt.effectiveGasPrice
    : undefined

// ---------------------------------------------------------------------------
// What a retry can fix
// ---------------------------------------------------------------------------

/**
 * The execution's causes that leave the attempt ready (D-393): the wait has
 * not ended yet, or a security stop holds a method the recovery used. The
 * execution's "still ready" reading renders for these and for a revert with no
 * cause the wallet can name; every other cause is the fifth ending, which
 * offers no retry.
 */
export const EXECUTION_STILL_READY_CAUSES: readonly KitErrorName[] = [
  'WaitNotOver',
  'MethodVetoedSpend'
]

/**
 * The submission's acceptance errors: the manager refused the request itself,
 * and sending the same request again cannot land (D-393: a submission rejected
 * because an attempt already runs, or refused while a method is stopped, gets
 * its own copy, since retrying cannot help).
 */
const SUBMISSION_ACCEPTANCE_ERRORS: readonly KitErrorName[] = [
  'NoSetup',
  'AttemptAlreadyActive',
  'WrongAttemptId',
  'WrongSetupNonce',
  'SetupCommitmentMismatch',
  'StaleAttempt',
  'PlaceOutOfRange',
  'CredentialMismatch',
  'PlacesNotStrictlyIncreasing',
  'RequestExpired',
  'ProofRejected',
  'MethodStopped',
  'RuleUnsatisfied',
  'MalformedHandover',
  'ReservedAuthority'
]

/**
 * The kit errors no retry of the same write fixes, by write. A failed state
 * whose decoded cause is one of these offers no retry.
 *
 * - The save and the edit: a commitment the recovery registry refuses.
 * - Another setup write: the removal of a setup that is not there.
 * - The cancel: none here; a cancel with nothing left to cancel reads the gone
 *   attempt, which offers no retry either.
 * - The submission: the manager's acceptance errors.
 * - The execution: every cause but the two that leave the attempt ready.
 */
export const NO_RETRY_CAUSES: { readonly [W in WriteKind]: readonly KitErrorName[] } = {
  save: ['InvalidCommitment'],
  edit: ['InvalidCommitment'],
  ownerWrite: ['NoSetup'],
  cancel: [],
  submission: SUBMISSION_ACCEPTANCE_ERRORS,
  execution: KIT_ERROR_NAMES.filter((name) => !EXECUTION_STILL_READY_CAUSES.includes(name))
}

/** Whether a revert of a write leaves something a retry can fix. */
export const retryCanFix = (write: WriteKind, cause: RevertCause): boolean => {
  if (cause.kind === 'attemptGone') return false
  if (cause.kind === 'named') return !NO_RETRY_CAUSES[write].includes(cause.name)
  return true
}

/**
 * Whether a reverted execution leaves the attempt ready (D-393): a cause of
 * `EXECUTION_STILL_READY_CAUSES`, or one the wallet cannot name.
 */
export const leavesAttemptReady = (cause: RevertCause): boolean =>
  cause.kind === 'unnamed' ||
  (cause.kind === 'named' && EXECUTION_STILL_READY_CAUSES.includes(cause.name))

// ---------------------------------------------------------------------------
// The classification
// ---------------------------------------------------------------------------

/** What classifying a write's end needs beside the end itself. */
export interface FailureContext {
  write: WriteKind
  /** For a cancel: the attempt read after the revert, where it returned (D-307). */
  attemptAfter?: AttemptAfterCancel
}

const revertedState = (
  receipt: WriteReceipt,
  context: FailureContext,
  cause?: KitError
): FailedRevertedState => {
  const gasSpent = gasSpentOf(receipt)
  return {
    status: 'failedReverted',
    write: context.write,
    transactionHash: receipt.transactionHash,
    receipt,
    cause: revertCauseOf(context.write, cause, context.attemptAfter),
    ...(cause ? { decoded: cause } : {}),
    ...(gasSpent !== undefined ? { gasSpent } : {})
  }
}

/**
 * Classifies a write that did not land (D-319), by whether a transaction hash
 * exists and whether a receipt with status zero came back:
 *
 * - a transaction another one replaced before it was mined, other than a mere
 *   repricing, reads `failedNotSent` with that reason: the write's own call
 *   never ran, whatever the replacement did;
 * - a receipt with status zero reads `failedReverted`, with the cause the
 *   receipt carries and its gas gone; a cancel's may read that the attempt was
 *   already gone (D-307, `revertCauseOf`);
 * - no receipt and no transaction hash reads `failedNotSent`: nothing reached
 *   the chain and the account stands as it did;
 * - a transaction hash with no receipt is neither: the call may still land, so
 *   the answer is the submitting state with that hash, which keeps waiting for
 *   its receipt and never reads that nothing was sent.
 *
 * A receipt with status one is no failure (`settleReceipt` reads it as
 * landed), so this throws a TypeError for one.
 */
export const classifyFailure = (
  failure: WriteFailure,
  context: FailureContext
): FailedState | SubmittingState => {
  const { receipt } = failure
  if (failure.replaced) {
    return {
      status: 'failedNotSent',
      write: context.write,
      error: failure.error,
      replaced: failure.replaced
    }
  }
  if (receipt) {
    if (receipt.status === 1) {
      throw new TypeError('A receipt with status one is no failure: settle it as landed.')
    }
    return revertedState(receipt, context, failure.cause)
  }
  if (failure.transactionHash) {
    return { status: 'submitting', write: context.write, transactionHash: failure.transactionHash }
  }
  const notSent: FailedNotSentState = {
    status: 'failedNotSent',
    write: context.write,
    error: failure.error
  }
  return notSent
}

/**
 * Settles a write from its receipt: status one reads `landed`, status zero the
 * reverted reading of `classifyFailure`, with the cause the wallet decoded.
 */
export const settleReceipt = (
  receipt: WriteReceipt,
  context: FailureContext,
  cause?: KitError
): LandedState | FailedRevertedState =>
  receipt.status === 1
    ? { status: 'landed', write: context.write, transactionHash: receipt.transactionHash, receipt }
    : revertedState(receipt, context, cause)
