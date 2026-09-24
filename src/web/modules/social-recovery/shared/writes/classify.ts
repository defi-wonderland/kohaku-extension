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
 * already gone, with the account's controller as it now stands.
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
 * What the wallet knows of a write that did not land. `error` is what the send
 * threw; `transactionHash` is present once the wallet broadcast the call;
 * `receipt` is present once one came back; `cause` is the revert the wallet
 * decoded for that receipt (the SDK's error decoding over the call), where it
 * read one.
 */
export interface WriteFailure {
  error?: unknown
  transactionHash?: Hex
  receipt?: WriteReceipt
  cause?: KitError
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

/**
 * Reads what a thrown value tells about the call: a receipt it carries (ethers'
 * `CALL_EXCEPTION` from `wait()` carries the reverted receipt) or the hash of a
 * transaction it names (`transactionHash`, `hash`, `transaction.hash`). A value
 * that carries neither is an error before any hash.
 */
export const writeFailureOf = (thrown: unknown): WriteFailure => {
  const seen = new Set<unknown>()
  let receipt: WriteReceipt | undefined
  let transactionHash: Hex | undefined

  const visit = (value: unknown, depth: number): void => {
    if (depth > 4 || !value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    const record = value as Record<string, unknown>
    if (!receipt) receipt = receiptOf(record.receipt)
    if (!transactionHash) {
      if (isTransactionHash(record.transactionHash)) transactionHash = record.transactionHash
      else if (isTransactionHash(record.hash)) transactionHash = record.hash
    }
    ;['transaction', 'info', 'error', 'cause'].forEach((key) => visit(record[key], depth + 1))
  }

  visit(thrown, 0)
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

/**
 * The attempt read after a reverted cancel (ux.md D-307): how the attempt had
 * ended and the account's controller as it now stands. The controller is the
 * key the consume event handed the account after an execution, and the
 * account's own key where another road ended the attempt.
 */
export interface AttemptAfterCancel {
  ended: AttemptEnd
  controller?: Address
}

/**
 * The cause a reverted state names.
 *
 * - `named`: a kit error of sdk.md D-205 the wallet decoded, which it names in
 *   its own words.
 * - `unnamed`: a revert that carries no cause the wallet can name, with its raw
 *   data where it read any.
 * - `attemptGone`: the owner's cancel reverted because the attempt was already
 *   gone (D-307). `ended` and `controller` are present once the attempt read
 *   after the revert returned; until then the state names no controller rather
 *   than one it guessed.
 */
export type RevertCause =
  | { kind: 'named'; name: KitErrorName; error: KitError }
  | { kind: 'unnamed'; data?: Hex }
  | { kind: 'attemptGone'; ended?: AttemptEnd; controller?: Address }

export const REVERT_CAUSE_KINDS = ['named', 'unnamed', 'attemptGone'] as const

const isKitErrorName = (name: string): name is KitErrorName =>
  (KIT_ERROR_NAMES as readonly string[]).includes(name)

/** The kit error the manager raises on a cancel with nothing to cancel (contracts D-103). */
const NOTHING_TO_CANCEL: KitErrorName = 'NoActiveAttempt'

/**
 * The cause of a revert for a write. A reverted cancel reads that the attempt
 * was already gone (D-307), since the owner's cancel names no id and reverts
 * only when nothing is left to cancel, unless the decoded cause names another
 * kit error, which then reads as that error. Every other write names the kit
 * error it decoded, or reads as a revert with no cause it can name.
 */
export const revertCauseOf = (
  write: WriteKind,
  cause?: KitError,
  attemptAfter?: AttemptAfterCancel
): RevertCause => {
  const known = cause?.kind === 'known' && isKitErrorName(cause.name) ? cause.name : undefined
  if (write === 'cancel' && (known === undefined || known === NOTHING_TO_CANCEL)) {
    return {
      kind: 'attemptGone',
      ...(attemptAfter ? { ended: attemptAfter.ended } : {}),
      ...(attemptAfter?.controller ? { controller: attemptAfter.controller } : {})
    }
  }
  if (known !== undefined && cause) return { kind: 'named', name: known, error: cause }
  return cause?.kind === 'unknown' ? { kind: 'unnamed', data: cause.data } : { kind: 'unnamed' }
}

/** The gas a reverted receipt spent, where the receipt carries both factors. */
export const gasSpentOf = (receipt: WriteReceipt): bigint | undefined =>
  receipt.gasUsed !== undefined && receipt.effectiveGasPrice !== undefined
    ? receipt.gasUsed * receipt.effectiveGasPrice
    : undefined

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
    ...(gasSpent !== undefined ? { gasSpent } : {})
  }
}

/**
 * Classifies a write that did not land (D-319), by whether a transaction hash
 * exists and whether a receipt with status zero came back:
 *
 * - a receipt with status zero reads `failedReverted`, with the cause the
 *   receipt carries and its gas gone; a cancel's reads that the attempt was
 *   already gone (D-307);
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
