/**
 * Where the recovery stands after one poll, from the attempt the manager
 * reports, the events that tell its story and the account's four checks.
 * Pure: every decision takes the poll's own reads and nothing read later.
 */
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import type { Address, Configuration } from '@web/modules/social-recovery/sdk-interfaces'
import { CHECKLIST_SEARCH_KEYS } from '@web/modules/social-recovery/recovery/checklist'

import { isAttemptOf } from './read'
import type {
  AttemptStory,
  CannotExecuteCause,
  CountdownAnchor,
  WaitFacts,
  WaitPhase,
  WaitRound
} from './types'

/**
 * Why the recovery can no longer execute, read from the account: it no
 * longer authorizes the action, the action no longer fits it, or a key moved
 * a privilege the handover needs. Null where every check passes.
 */
export const cannotExecuteCauseOf = (facts: WaitFacts): CannotExecuteCause | null => {
  if (!facts.authorized) {
    return 'notAuthorized'
  }
  if (!facts.supported) {
    return 'upgradedAway'
  }
  if (!facts.removedHolds || facts.newKeyHolds) {
    return 'privilegeMoved'
  }
  return null
}

/** Whether the attempt the manager reports is the recovery's own: by its opening event, else by its id. */
const oursOf = (facts: WaitFacts, story: AttemptStory): boolean => {
  const { attempt } = facts
  if (story.started) {
    return isAttemptOf(attempt, story.started)
  }
  return attempt.state !== 'None' && story.attemptId === attempt.attemptId
}

/**
 * The phase one poll reads:
 * - the recovery's own attempt consumed: executed; cancelled: cancelled, by
 *   the canceller its event names (none where no event names one); waiting:
 *   cannot execute where a check fails, else execution due once its
 *   `consumableAfter` is at or before the pinned block's time, else waiting;
 * - no attempt of its own in the read: its consume or cancel event decides,
 *   and with neither the attempt is gone another way, which only a setup
 *   write does.
 */
export const phaseOf = (facts: WaitFacts, story: AttemptStory): WaitPhase => {
  const { attempt, block } = facts
  if (oursOf(facts, story)) {
    if (attempt.state === 'Consumed') {
      return { kind: 'consumed' }
    }
    if (attempt.state === 'Cancelled') {
      return { kind: 'cancelled', by: story.cancelled?.cancelledBy ?? null }
    }
    const cause = cannotExecuteCauseOf(facts)
    if (cause) {
      return { kind: 'cannotExecute', attempt, cause }
    }
    return attempt.consumableAfter <= block.timestamp
      ? { kind: 'executionDue', attempt }
      : { kind: 'waiting', attempt }
  }
  if (story.consumed) {
    return { kind: 'consumed' }
  }
  if (story.cancelled) {
    return { kind: 'cancelled', by: story.cancelled.cancelledBy }
  }
  return { kind: 'cancelled', by: 'setupWrite' }
}

/** Whether a poll needs the events beside the attempt read: no opening known for a live attempt of its own, or the attempt ended. */
export const needsStory = (facts: WaitFacts, known: AttemptStory | null): boolean =>
  !known?.started || facts.attempt.state !== 'Waiting' || !isAttemptOf(facts.attempt, known.started)

/** The countdown's anchor from a poll that read a running attempt; null for any other phase. */
export const anchorOf = (round: WaitRound): CountdownAnchor | null => {
  const { phase, facts } = round
  if (phase.kind !== 'waiting' && phase.kind !== 'cannotExecute' && phase.kind !== 'executionDue') {
    return null
  }
  return {
    endMs: phase.attempt.consumableAfter * 1000,
    blockMs: facts.block.timestamp * 1000,
    round: round.round
  }
}

/**
 * Whether one approval satisfies the rule, so the same credential can cancel
 * again: the path's only clause with members asks for one of them.
 */
export const thresholdOneOf = (configuration: Configuration): boolean => {
  const clauses = configuration.clauses.filter((clause) => clause.credentials.length > 0)
  return clauses.length === 1 && clauses[0]?.threshold === 1
}

/** The done screen of an account whose recovery executed. */
export const donePathOf = (account: Address): string => {
  const query = new URLSearchParams()
  query.set(CHECKLIST_SEARCH_KEYS.account, account)
  return `/${WEB_ROUTES.socialRecoveryRecoveryDone}?${query.toString()}`
}
