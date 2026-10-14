/**
 * What the page reads of a request, as pure functions over the request, the
 * chain reads and the page's clock: whether its domain is this build's, the
 * state that takes the place of the sign action, and whether the sign action
 * is enabled.
 */
import { isAddressEqual, keccak256 } from 'viem'

import type {
  ApproverRequest,
  Attempt,
  Notification
} from '@web/modules/social-recovery/sdk-interfaces'
import { attemptLive } from '@web/modules/social-recovery/recovery/checklist'

import type {
  ApprovalClient,
  ApprovalFacts,
  ApprovalReading,
  ApprovalReads,
  DomainOfBuild,
  SignGates
} from './types'

/**
 * Whether the request is aimed at the deployment this build reads: the same
 * chain, the same manager and the same digest version. The build's client
 * refuses a manager whose published domain carries another digest version,
 * so a request that agrees here also agrees with the manager's own domain.
 */
export const domainAgrees = (request: ApproverRequest, build: DomainOfBuild): boolean =>
  request.chainId === String(build.chainId) &&
  isAddressEqual(request.manager, build.manager) &&
  request.digestVersion === build.digestVersion

/**
 * Whether the clock, in ms, has reached the request's deadline: no time left
 * reads as expired, as the deadline's own line reads it.
 */
const requestExpired = (request: ApproverRequest, clock: number): boolean =>
  clock >= Number(request.validUntil) * 1000

/**
 * Whether the account's attempt is this request's own submission, waiting or
 * already ended: it carries the request's attempt id, the setup nonce the
 * request was built under and the hash of the request's handover. The id
 * alone names whoever opened next, so another holder's attempt can carry it.
 */
const isOwnAttempt = (request: ApproverRequest, attempt: Attempt): boolean =>
  attempt.state !== 'None' &&
  attempt.attemptId === BigInt(request.attemptId) &&
  attempt.setupNonce === BigInt(request.setupNonce) &&
  request.payload !== undefined &&
  keccak256(request.payload) === attempt.payloadHash

/**
 * Whether an event is an attempt start of the request's account and action
 * whose attempt id is at or below the request's: the request's own start, or
 * one that opened before it. A backward scan of the events stops at the first
 * such start, since attempt ids only grow.
 */
export const startedAtOrBelow = (request: ApproverRequest, log: Notification): boolean =>
  log.kind === 'attempt-started' &&
  isAddressEqual(log.account, request.account) &&
  isAddressEqual(log.action, request.action) &&
  log.attemptId <= BigInt(request.attemptId)

/**
 * Whether an attempt-started event is this request's own submission: the
 * request's account and action, its attempt id, the setup nonce it was built
 * under and the hash of its handover.
 */
export const isOwnStart = (request: ApproverRequest, log: Notification): boolean =>
  startedAtOrBelow(request, log) &&
  log.kind === 'attempt-started' &&
  log.attemptId === BigInt(request.attemptId) &&
  log.setupNonce === BigInt(request.setupNonce) &&
  request.payload !== undefined &&
  keccak256(log.payload) === keccak256(request.payload)

/**
 * The reading of an answered round. A request the recoverer submitted reads
 * as waiting until its recovery ends and as used after that, never as void:
 * where its attempt left the slot, the round's `submitted` tells it apart.
 * Otherwise the deaths in this order: expired, another attempt waiting, the
 * setup changed, the attempt counter moved past the request's id. A request
 * with none of them is live, the account authorizing the action or not.
 */
export const readingOfFacts = (
  request: ApproverRequest,
  facts: ApprovalFacts,
  clock: number
): ApprovalReading => {
  if (isOwnAttempt(request, facts.attempt)) {
    return attemptLive(facts.attempt)
      ? {
          kind: 'waiting',
          endsAt: facts.attempt.consumableAfter * 1000,
          authorized: facts.authorized
        }
      : { kind: 'dead', death: 'used' }
  }
  if (requestExpired(request, clock)) {
    return { kind: 'dead', death: 'expired' }
  }
  const replaced: ApprovalReading = { kind: 'dead', death: facts.submitted ? 'used' : 'void' }
  if (attemptLive(facts.attempt)) {
    return replaced
  }
  if (facts.setupNonce !== BigInt(request.setupNonce)) {
    return { kind: 'dead', death: 'setup-changed' }
  }
  if (facts.nextAttemptId > BigInt(request.attemptId)) {
    return replaced
  }
  return { kind: 'live', authorized: facts.authorized }
}

/**
 * Whether a round must look up the request's own submission: the round reads
 * void, the attempt counter moved past the request's id and no attempt in
 * the slot is the request's own, so the request may have been submitted and
 * its attempt replaced since.
 */
export const submissionInQuestion = (
  request: ApproverRequest,
  facts: ApprovalFacts,
  clock: number
): boolean => {
  const reading = readingOfFacts(request, facts, clock)
  return (
    reading.kind === 'dead' &&
    reading.death === 'void' &&
    facts.nextAttemptId > BigInt(request.attemptId)
  )
}

/**
 * The reading of the page: another deployment before any read and where the
 * manager publishes a digest version this build does not sign, then the
 * client and the reads, where nothing answered yet reads as reading and a
 * failure as failed, never as a death and never as live.
 */
export const readingOf = (
  request: ApproverRequest,
  build: DomainOfBuild,
  client: ApprovalClient,
  reads: ApprovalReads,
  clock: number
): ApprovalReading => {
  if (!domainAgrees(request, build) || client.status === 'refused') {
    return { kind: 'other-deployment' }
  }
  if (client.status === 'failed') {
    return { kind: 'failed' }
  }
  if (client.status === 'loading' || reads.status === 'pending') {
    return { kind: 'reading' }
  }
  if (reads.status === 'failed') {
    return { kind: 'failed' }
  }
  return readingOfFacts(request, reads.facts, clock)
}

/**
 * Whether the request no longer takes an approval: its deadline passed on the
 * page's clock, whatever the reads say, or the reading is a death or the
 * recoverer's submission.
 */
export const approvalEnded = (
  request: ApproverRequest,
  reading: ApprovalReading,
  clock: number
): boolean =>
  requestExpired(request, clock) || reading.kind === 'dead' || reading.kind === 'waiting'

/**
 * Whether the sign action is enabled: the four values and the deadline
 * rendered, the request live with the account authorizing the action, and
 * the acknowledgment ticked.
 */
export const signEnabled = ({ values, deadline, reading, acknowledged }: SignGates): boolean =>
  values.rendered &&
  deadline !== null &&
  !deadline.passed &&
  reading.kind === 'live' &&
  reading.authorized &&
  acknowledged
