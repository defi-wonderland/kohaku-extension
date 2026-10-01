/**
 * The check after a landed save, read once the batch's receipt came back. The
 * save reads as saved only where the check answers that the setup landed and
 * that the recovery module recognizes the account's authorization. A setup the
 * module does not recognize, a commitment the wallet rebuilds differently, or
 * a setup the check still cannot find after a second read each read as
 * disagreed. A check that throws for any other reason, or does not answer in
 * time, reads as unanswered. No answer but the first reads as saved.
 */
import type { SetupConfirmation } from '@web/modules/social-recovery/sdk-interfaces'

import { COMMITMENT_MISMATCH_CODE, CONFIRM_READ_TIMEOUT_MS } from './constants'
import type { ConfirmOutcome, ConfirmReadOptions } from './types'

const AGREED: ConfirmOutcome = { kind: 'agreed' }
const MISMATCH: ConfirmOutcome = { kind: 'disagreed', check: 'mismatch' }
const UNAUTHORIZED: ConfirmOutcome = { kind: 'disagreed', check: 'authorization' }
const UNREAD: ConfirmOutcome = { kind: 'unread' }

/**
 * The outcome of one answer of the check, or null where it did not find the
 * setup on chain, which the save reads once more.
 */
export const outcomeOfConfirmation = (confirmation: SetupConfirmation): ConfirmOutcome | null => {
  if (!confirmation.landed) {
    return null
  }
  return confirmation.isAuthorized ? AGREED : UNAUTHORIZED
}

/** The outcome of a check that threw: the commitment's mismatch disagrees, anything else is unanswered. */
export const outcomeOfConfirmFailure = (thrown: unknown): ConfirmOutcome => {
  const code =
    typeof thrown === 'object' && thrown !== null ? (thrown as { code?: unknown }).code : undefined
  return code === COMMITMENT_MISMATCH_CODE ? MISMATCH : UNREAD
}

/** One read of the check, which rejects where it does not answer in time. */
const readInTime = (
  confirm: () => Promise<SetupConfirmation>,
  timeoutMs: number
): Promise<SetupConfirmation> =>
  new Promise<SetupConfirmation>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`The check after the save did not answer in ${timeoutMs} ms.`)),
      timeoutMs
    )
    Promise.resolve()
      .then(confirm)
      .then(
        (confirmation) => {
          clearTimeout(timer)
          resolve(confirmation)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error)
        }
      )
  })

/**
 * Reads the check, and once more where it did not find the setup on chain;
 * a setup the second read still cannot find reads as the commitment's
 * mismatch.
 */
export const confirmOutcomeOf = async (
  confirm: () => Promise<SetupConfirmation>,
  options: ConfirmReadOptions = {}
): Promise<ConfirmOutcome> => {
  const timeoutMs = options.timeoutMs ?? CONFIRM_READ_TIMEOUT_MS
  try {
    const first = outcomeOfConfirmation(await readInTime(confirm, timeoutMs))
    if (first) {
      return first
    }
    return outcomeOfConfirmation(await readInTime(confirm, timeoutMs)) ?? MISMATCH
  } catch (thrown: unknown) {
    return outcomeOfConfirmFailure(thrown)
  }
}
