/**
 * The checklist's poll of the account's recovery state and the deaths it
 * reads: the attempt the manager holds, its counters, the setup nonce and
 * whether the account still authorizes the action. A read that throws, or
 * that does not answer within its limit, is a failed poll, never the last
 * good reading. Every decision takes the clock read before the poll's read.
 */
import type { Attempt, Gathering } from '@web/modules/social-recovery/sdk-interfaces'
import type { DirectWipeEvent } from '@web/modules/social-recovery/shared/records'

import type { ChecklistKitClient, ChecklistLoad, PollFacts, PollTarget } from './types'

/**
 * One poll: the recovery state and the authorization read together. Resolves
 * to undefined where either read throws or where both have not answered
 * within `limitMs`.
 */
export const readPollFacts = (
  kit: Pick<ChecklistKitClient, 'recovery' | 'action'>,
  limitMs: number
): Promise<PollFacts | undefined> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), limitMs)
    Promise.resolve()
      .then(() => Promise.all([kit.recovery.recoveryState(), kit.action.isAuthorized()]))
      .then(
        ([state, authorized]) => {
          clearTimeout(timer)
          resolve({
            attempt: state.attempt,
            nextAttemptId: state.nextAttemptId,
            setupNonce: state.setupNonce,
            authorized
          })
        },
        () => {
          clearTimeout(timer)
          resolve(undefined)
        }
      )
  })

/** Whether an attempt holds the account's one slot: it waits out its period. */
export const attemptLive = (attempt: Attempt): boolean => attempt.state === 'Waiting'

/** Whether the clock, in ms, is past the request's deadline. */
export const deadlinePassed = (gathering: Gathering, clock: number): boolean =>
  Math.floor(clock / 1000) > Number(gathering.request.validUntil)

/**
 * The death a poll reads for a live gathering, or null where the request
 * still lives:
 * - another attempt opened: an attempt other than the predicted one waits, or
 *   the attempt counter moved past the predicted id while the predicted
 *   attempt is not the one waiting;
 * - the setup changed: the setup nonce is not the one the request was built
 *   under.
 * A waiting attempt is named first, since it holds the slot a new gathering
 * would need.
 */
export const deathOf = (gathering: Gathering, facts: PollFacts): DirectWipeEvent | null => {
  const predicted = BigInt(gathering.request.attemptId)
  const live = attemptLive(facts.attempt)
  const ours = live && facts.attempt.attemptId === predicted
  if (live && !ours) {
    return 'another-attempt-opened'
  }
  if (facts.setupNonce !== BigInt(gathering.request.setupNonce)) {
    return 'setup-changed'
  }
  if (facts.nextAttemptId > predicted && !ours) {
    return 'another-attempt-opened'
  }
  return null
}

/**
 * What the poll reads for: the request of a live session, and a session
 * another attempt voided, which polls until the slot is free. Every other
 * state reads nothing.
 */
export const pollTargetOf = (load: ChecklistLoad): PollTarget | null => {
  if (load.phase === 'live') {
    const { request } = load.session.gathering
    return {
      kind: 'live',
      key: `live:${request.attemptId}:${request.setupNonce}:${request.validUntil}`,
      gathering: load.session.gathering
    }
  }
  if (load.phase === 'wiped' && load.session.reason === 'another-attempt-opened') {
    return { kind: 'void', key: `void:${load.revision}` }
  }
  return null
}
